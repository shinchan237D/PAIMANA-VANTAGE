from __future__ import annotations
import csv, io, json, re, sqlite3, uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import ACTIVE_REPORT_PERIOD, OFFICIAL_DASHBOARD_URL, OFFICIAL_REPORTS_URL
from .db import db, ensure_schema, latest_period, latest_snapshot, project_by_code

@asynccontextmanager
async def lifespan(app):
    ensure_schema()
    yield

app=FastAPI(title='PAIMANA Sentinel API', version='4.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

STATE_COORDS={
 'Andhra Pradesh':(15.9129,79.7400),'Arunachal Pradesh':(28.2180,94.7278),'Assam':(26.2006,92.9376),'Bihar':(25.0961,85.3131),
 'Chhattisgarh':(21.2787,81.8661),'Delhi':(28.6139,77.2090),'Goa':(15.2993,74.1240),'Gujarat':(22.2587,71.1924),
 'Haryana':(29.0588,76.0856),'Himachal Pradesh':(31.1048,77.1734),'Jharkhand':(23.6102,85.2799),'Karnataka':(15.3173,75.7139),
 'Kerala':(10.8505,76.2711),'Madhya Pradesh':(22.9734,78.6569),'Maharashtra':(19.7515,75.7139),'Manipur':(24.6637,93.9063),
 'Meghalaya':(25.4670,91.3662),'Mizoram':(23.1645,92.9376),'Nagaland':(26.1584,94.5624),'Odisha':(20.9517,85.0985),
 'Punjab':(31.1471,75.3412),'Rajasthan':(27.0238,74.2179),'Sikkim':(27.5330,88.5122),'Tamil Nadu':(11.1271,78.6569),
 'Telangana':(18.1124,79.0193),'Tripura':(23.9408,91.9882),'Uttar Pradesh':(26.8467,80.9462),'Uttarakhand':(30.0668,79.0193),
 'West Bengal':(22.9868,87.8550),'Jammu & Kashmir':(33.7782,76.5762),'Ladakh':(34.1526,77.5770),'Puducherry':(11.9416,79.8083),
 'Andaman & Nicobar Islands':(11.7401,92.6586),'Chandigarh':(30.7333,76.7794),'Dadra & Nagar Haveli and Daman & Diu':(20.3974,72.8328)
}

class AIQuery(BaseModel):
    question: str = Field(min_length=1,max_length=1000)
    language: str='en'
class InterventionUpdate(BaseModel):
    status: str
    note: str=''

ALLOWED_INTERVENTION={'FLAGGED','ASSIGNED','UNDER_REVIEW','MITIGATION','FOLLOW_UP','RESOLVED'}


def month_index(period:str)->int:
    y,m=map(int,period[:7].split('-')); return y*12+m

def months_between(period:str, iso:str|None)->int|None:
    if not iso: return None
    try:
        d=date.fromisoformat(str(iso)); return max(0,(d.year*12+d.month)-month_index(period))
    except Exception: return None

def safe_float(v):
    try:return float(v) if v is not None else None
    except:return None

def latest_rows(con):
    period=latest_period(con)
    return con.execute('''select p.*,s.* from projects p join project_snapshots s on s.project_id=p.id where s.report_period=? order by p.project_code''',(period,)).fetchall()

def history_rows(con,pid):
    return con.execute('select * from project_snapshots where project_id=? and report_period<=? order by report_period',(pid,ACTIVE_REPORT_PERIOD)).fetchall()

def commitment_revisions(rows):
    vals=[r['revised_end_date'] for r in rows if r['revised_end_date']]
    return sum(1 for a,b in zip(vals,vals[1:]) if a!=b)

def trajectory_metrics(rows,current):
    ordered=list(rows); pairs=[]
    for a,b in zip(ordered,ordered[1:]):
        pa,pb=safe_float(a['physical_progress_pct']),safe_float(b['physical_progress_pct'])
        if pa is None or pb is None: continue
        pairs.append({'from':a['report_period'],'to':b['report_period'],'delta':pb-pa})
    recent=pairs[-3:]
    velocity=sum(x['delta'] for x in recent)/len(recent) if recent else None
    negative=sum(1 for x in recent if x['delta']< -2)
    stagnant=sum(1 for x in recent if abs(x['delta'])<0.5)
    revisions=commitment_revisions(ordered)
    end=current['revised_end_date'] or current['original_end_date']
    remaining=months_between(current['report_period'],end)
    progress=safe_float(current['physical_progress_pct'])
    required=None
    if progress is not None and remaining is not None and remaining>0:
        required=max(0,(100-progress)/remaining)
    overdue=bool(progress is not None and progress<100 and remaining==0)
    return {'velocity_recent_pct_per_month':velocity,'negative_movements_recent':negative,'stagnant_movements_recent':stagnant,
            'commitment_revisions':revisions,'months_remaining':remaining,'required_monthly_progress_pct':required,'overdue':overdue,
            'time_pressure_ratio':(required/velocity if required is not None and velocity and velocity>0 else None)}

def attention(con,p,current):
    hist=history_rows(con,p['id']); m=trajectory_metrics(hist,current)
    progress=safe_float(current['physical_progress_pct']) or 0
    revised=safe_float(current['revised_cost_crore']) or safe_float(current['original_cost_crore']) or 0
    spent=safe_float(current['expenditure_crore']) or 0
    exposure=max(0,revised-spent)
    score=0.0; reasons=[]
    if m['overdue']:
        score+=48; reasons.append('Revised commitment is past while reported progress is below 100%.')
    elif m['required_monthly_progress_pct'] is not None:
        r=m['required_monthly_progress_pct']
        if r>=15: score+=35; reasons.append(f'Required recovery rate is {r:.1f}% progress/month.')
        elif r>=10: score+=27; reasons.append(f'Required recovery rate is {r:.1f}% progress/month.')
        elif r>=6: score+=18; reasons.append(f'Required recovery rate is {r:.1f}% progress/month.')
        elif r>=3: score+=9
    if m['velocity_recent_pct_per_month'] is not None and m['required_monthly_progress_pct'] is not None:
        gap=m['required_monthly_progress_pct']-m['velocity_recent_pct_per_month']
        if gap>8: score+=24; reasons.append(f'Recent observed velocity trails required rate by {gap:.1f} points/month.')
        elif gap>4: score+=15; reasons.append(f'Recent observed velocity trails required rate by {gap:.1f} points/month.')
        elif gap>1.5: score+=7
    if m['commitment_revisions']>=3: score+=15; reasons.append(f'{m["commitment_revisions"]} commitment-date changes are present in stored history.')
    elif m['commitment_revisions']==2: score+=9; reasons.append('Two commitment-date changes are present in stored history.')
    elif m['commitment_revisions']==1: score+=4
    if m['negative_movements_recent']>=2: score+=10; reasons.append('Recent history contains repeated negative progress movements; baseline-reset review is required.')
    if m['stagnant_movements_recent']>=2: score+=6; reasons.append('Recent reporting shows repeated near-zero progress movement.')
    if revised>0 and spent/revised<0.15 and progress>35: score+=5; reasons.append('Physical progress is materially ahead of cumulative expenditure share; inspect measurement basis.')
    score=min(100,round(score,1))
    if m['overdue'] or score>=75: band='BREACHED' if m['overdue'] else 'BREACH_RISK'
    elif score>=55: band='UNSTABLE'
    elif score>=35: band='PRESSURED'
    elif score>=18: band='WATCH'
    else: band='STABLE'
    return {'attention_score':score,'state':band,'reasons':reasons[:5],'exposure_crore':exposure,'metrics':m}

def current_item(con,p):
    s=latest_snapshot(con,p['id'])
    if not s:return None
    a=attention(con,p,s)
    return {
      'project_code':p['project_code'],'name':p['name'],'agency':p['agency'],'ministry':p['ministry'],'sector':p['sector'],'state':p['state'],
      'latitude':p['latitude'],'longitude':p['longitude'],'location_status':p['location_status'],'physical_progress_pct':s['physical_progress_pct'],
      'original_cost_crore':s['original_cost_crore'],'revised_cost_crore':s['revised_cost_crore'],'expenditure_crore':s['expenditure_crore'],
      'original_end_date':s['original_end_date'],'revised_end_date':s['revised_end_date'],'report_period':s['report_period'],'reporting_cutoff':s['reporting_cutoff'],
      'attention_score':a['attention_score'],'state_code':a['state'],'priority_score':a['attention_score'],'priority_band':a['state'],
      'risk_band':a['state'],'reasons':a['reasons'],'exposure_crore':a['exposure_crore'],'metrics':a['metrics']
    }

def evidence(con,p):
    s=latest_snapshot(con,p['id']); item=current_item(con,p); hist=history_rows(con,p['id'])
    flags=con.execute('select rule_code,severity,message from integrity_flags where snapshot_id=? and is_open=1 order by case severity when "critical" then 0 when "high" then 1 when "medium" then 2 else 3 end',(s['id'],)).fetchall()
    return {'observed':[
      {'label':'Physical progress','value':s['physical_progress_pct'],'unit':'%','type':'observed','source':'April 2026 Flash Report'},
      {'label':'Revised cost','value':s['revised_cost_crore'],'unit':'₹ crore','type':'observed','source':'April 2026 Flash Report'},
      {'label':'Cumulative expenditure','value':s['expenditure_crore'],'unit':'₹ crore','type':'observed','source':'April 2026 Flash Report'},
      {'label':'Revised completion','value':s['revised_end_date'],'unit':'date','type':'observed','source':'April 2026 Flash Report'}],
      'derived':[{'label':'Required monthly progress','value':item['metrics']['required_monthly_progress_pct'],'unit':'percentage points/month','type':'derived','basis':'Current progress and reported completion date'},
                 {'label':'Recent velocity','value':item['metrics']['velocity_recent_pct_per_month'],'unit':'percentage points/month','type':'derived','basis':'Last three observed reporting intervals'},
                 {'label':'Commitment revisions','value':item['metrics']['commitment_revisions'],'unit':'changes','type':'derived','basis':'Stored project history'}],
      'integrity':[dict(x) for x in flags],
      'source':{'report_period':s['report_period'],'reporting_cutoff':s['reporting_cutoff'],'portal':OFFICIAL_DASHBOARD_URL,'report_index':OFFICIAL_REPORTS_URL},
      'semantics':'Observed facts are separated from Sentinel-derived metrics. State bands are rule-based attention states, not government classifications and not calibrated probabilities.'}

def historical_comparables(con,p):
    current=latest_snapshot(con,p['id']); progress=safe_float(current['physical_progress_pct'])
    cost=safe_float(current['revised_cost_crore']) or safe_float(current['original_cost_crore'])
    if progress is None or cost is None:return {'cohort_size':0,'recovered_count':0,'missed_count':0,'unknown_count':0,'matches':[],'plausibility':'INSUFFICIENT_DATA'}
    candidates=[]
    rows=con.execute('''select s.*,p.project_code,p.name,p.state,p.sector,p.ministry from project_snapshots s join projects p on p.id=s.project_id
                        where s.report_period<? and s.report_period>=? and s.physical_progress_pct is not null''',(current['report_period'],'2025-07')).fetchall()
    for r in rows:
        if r['project_id']==p['id']: continue
        rp=safe_float(r['physical_progress_pct']); rc=safe_float(r['revised_cost_crore']) or safe_float(r['original_cost_crore'])
        if rp is None or rc is None:continue
        dist=abs(rp-progress)/25 + abs((rc-cost)/max(cost,1))/2
        if r['sector'] and p['sector'] and r['sector']==p['sector']: dist-=0.25
        if r['ministry'] and p['ministry'] and r['ministry']==p['ministry']: dist-=0.15
        if r['state'] and p['state'] and r['state']==p['state']: dist-=0.10
        future=con.execute('select * from project_snapshots where project_id=? and report_period>? and report_period<=? order by report_period limit 6',(r['project_id'],r['report_period'],ACTIVE_REPORT_PERIOD)).fetchall()
        outcome='UNKNOWN'
        if future:
            last=future[-1]; lp=safe_float(last['physical_progress_pct'])
            if lp is not None and lp>=100: outcome='RECOVERED'
            else:
                end=last['revised_end_date'] or last['original_end_date']
                if end and months_between(future[-1]['report_period'],end)==0 and (lp or 0)<100: outcome='MISSED'
        candidates.append((dist,r,outcome))
    candidates.sort(key=lambda x:x[0]); top=candidates[:12]
    rec=sum(1 for _,_,o in top if o=='RECOVERED'); miss=sum(1 for _,_,o in top if o=='MISSED'); unk=len(top)-rec-miss
    req=trajectory_metrics(history_rows(con,p['id']),current)['required_monthly_progress_pct']
    if req is None or len(top)<5:pl='INSUFFICIENT_DATA'
    elif rec>miss and req<10:pl='WITHIN_RECOVERY_HISTORY'
    elif req>=10 and miss>=rec:pl='ABOVE_RECOVERY_HISTORY'
    else:pl='UPPER_RANGE'
    matches=[]
    for d,r,o in top:
        matches.append({'project_code':r['project_code'],'name':r['name'],'snapshot_period':r['report_period'],'progress_pct':r['physical_progress_pct'],'revised_cost_crore':r['revised_cost_crore'],'outcome':o,'similarity':round(max(0,1/(1+d)),3)})
    return {'cohort_size':len(top),'recovered_count':rec,'missed_count':miss,'unknown_count':unk,'recovery_range':{'low':None,'high':None},'plausibility':pl,'matches':matches}

def portfolio(con):
    rows=latest_rows(con); items=[current_item(con,r) for r in rows]
    items=[x for x in items if x]
    def sm(k):return sum((safe_float(x[k]) or 0) for x in items)
    bands={b:sum(x['state_code']==b for x in items) for b in ['STABLE','WATCH','PRESSURED','UNSTABLE','BREACH_RISK','BREACHED']}
    progress=[safe_float(x['physical_progress_pct']) for x in items if safe_float(x['physical_progress_pct']) is not None]
    return {'report_period':ACTIVE_REPORT_PERIOD,'reporting_cutoff':max((x['reporting_cutoff'] for x in items if x['reporting_cutoff']),default=None),
      'project_count':len(items),'original_cost_crore':sm('original_cost_crore'),'revised_cost_crore':sm('revised_cost_crore'),'expenditure_crore':sm('expenditure_crore'),
      'average_progress_pct':sum(progress)/len(progress) if progress else None,'attention_bands':bands,
      'exposure_crore':sum(x['exposure_crore'] for x in items),'data_mode':'FROZEN_AS_OF','as_of':ACTIVE_REPORT_PERIOD,
      'source_note':'April 2026 PAIMANA Flash Report; Sentinel is frozen to this reporting period for the assessment build.'}

def log(con,action,obj_type=None,obj_id=None,payload=None):
    con.execute('insert into audit_logs(actor,action,object_type,object_id,payload_json,created_at) values(?,?,?,?,?,?)',('system',action,obj_type,str(obj_id) if obj_id is not None else None,json.dumps(payload or {}),datetime.now(timezone.utc).isoformat()))


@app.get('/')
def root():return {'name':'PAIMANA Sentinel','version':'4.0.0','status':'ready','as_of':ACTIVE_REPORT_PERIOD,'api':'/api/v3'}
@app.get('/api/v3/health')
def health():
    with db() as con:
        p=latest_period(con); n=con.execute('select count(*) n from project_snapshots where report_period=?',(p,)).fetchone()['n']
        return {'status':'ok','database':'ok','active_report':p,'current_snapshots':n,'mode':'frozen_as_of'}
@app.get('/api/v3/meta')
def meta():
    with db() as con:
        return {'product':'PAIMANA Sentinel','version':'4.0.0','active_report_period':ACTIVE_REPORT_PERIOD,'latest_available_report':ACTIVE_REPORT_PERIOD,
          'official_dashboard_url':OFFICIAL_DASHBOARD_URL,'official_reports_url':OFFICIAL_REPORTS_URL,
          'history':dict(con.execute('select min(report_period) earliest,max(report_period) latest,count(distinct report_period) periods,count(*) snapshots,count(distinct project_id) projects from project_snapshots').fetchone()),
          'periods':[dict(r) for r in con.execute('select report_period,count(*) snapshots,count(distinct project_id) projects from project_snapshots group by report_period order by report_period').fetchall()]}
@app.get('/api/v3/source')
def source():
    with db() as con:
        p=latest_period(con); s=con.execute('select * from source_snapshots where report_period=? order by id desc limit 1',(p,)).fetchone()
        releases=con.execute('select report_period,title,status,report_url,report_type,source_type,source_hash from source_releases order by report_period desc,id desc').fetchall()
        return {'current':dict(s) if s else None,'releases':[dict(r) for r in releases],'mode':'FROZEN_AS_OF','active_period':ACTIVE_REPORT_PERIOD,
                'freshness':{'label':'April 2026','data_cutoff':s['reporting_cutoff'] if s else None,'status':'validated_bundle'},
                'legacy_catalogued_periods':['2025-04','2025-05','2025-06'],'note':'April 2025–June 2025 files are catalogued as legacy-layout source material and are not mixed into the canonical monthly panel because their column structure differs from the PAIMANA layout used by the active history.'}
@app.get('/api/v3/portfolio')
def portfolio_route():
    with db() as con:return portfolio(con)
@app.get('/api/v3/portfolio/trends')
def trends():
    with db() as con:
        rows=con.execute('''select s.report_period,count(*) projects,avg(s.physical_progress_pct) avg_progress,sum(s.revised_cost_crore) revised_cost_crore,sum(s.expenditure_crore) expenditure_crore
                           from project_snapshots s group by s.report_period order by s.report_period''').fetchall()
        return {'items':[dict(r) for r in rows]}
@app.get('/api/v3/portfolio/changes')
def changes():
    with db() as con:
        periods=[r['report_period'] for r in con.execute('select distinct report_period from project_snapshots where report_period<=? order by report_period desc limit 2',(ACTIVE_REPORT_PERIOD,)).fetchall()]
        if len(periods)<2:return {'current_period':ACTIVE_REPORT_PERIOD,'previous_period':None,'summary':{},'projects':[]}
        cur,prev=periods
        rows=con.execute('''select p.project_code,p.name,p.state,c.physical_progress_pct current_progress,pr.physical_progress_pct previous_progress,
                                   c.revised_cost_crore current_cost,pr.revised_cost_crore previous_cost,c.revised_end_date current_end,pr.revised_end_date previous_end
                            from project_snapshots c join projects p on p.id=c.project_id left join project_snapshots pr on pr.project_id=c.project_id and pr.report_period=? where c.report_period=?''',(prev,cur)).fetchall()
        items=[]
        for r in rows:
            cp,pp=safe_float(r['current_progress']),safe_float(r['previous_progress']); delta=cp-pp if cp is not None and pp is not None else None
            cc,pc=safe_float(r['current_cost']),safe_float(r['previous_cost']); cost_delta=cc-pc if cc is not None and pc is not None else None
            completion_changed=r['current_end']!=r['previous_end'] if r['current_end'] and r['previous_end'] else False
            items.append({'project_code':r['project_code'],'name':r['name'],'state':r['state'],'progress_delta_pct':delta,'current_progress':cp,'previous_progress':pp,'revised_cost_delta_crore':cost_delta,'current_revised_cost':cc,'previous_revised_cost':pc,'completion_changed':completion_changed,'current_end':r['current_end'],'previous_end':r['previous_end']})
        moved=[x for x in items if x['progress_delta_pct'] is not None]
        cost_changed=[x for x in items if x['revised_cost_delta_crore'] is not None and abs(x['revised_cost_delta_crore'])>0.000001]
        return {'current_period':cur,'previous_period':prev,'summary':{'projects_current':len(rows),'progress_moved':len(moved),'positive_progress':sum(x['progress_delta_pct']>0 for x in moved),'negative_progress':sum(x['progress_delta_pct']<0 for x in moved),'stagnant_progress':sum(x['progress_delta_pct']==0 for x in moved),'completion_revised':sum(x['completion_changed'] for x in items),'cost_revised':len(cost_changed)},'projects':sorted(items,key=lambda x:abs(x['progress_delta_pct'] or 0),reverse=True)[:100]}
@app.get('/api/v3/projects')
def projects(search:str='',state:str='',ministry:str='',sector:str='',band:str='',page:int=1,page_size:int=50):
    page=max(1,page); page_size=max(1,min(page_size,200));
    with db() as con:
        rows=latest_rows(con); items=[current_item(con,r) for r in rows]
        q=search.strip().lower()
        if q:items=[x for x in items if q in ' '.join(str(x.get(k) or '') for k in ['project_code','name','ministry','agency','state','sector']).lower()]
        if state:items=[x for x in items if x['state']==state]
        if ministry:items=[x for x in items if x['ministry']==ministry]
        if sector:items=[x for x in items if x['sector']==sector]
        if band:items=[x for x in items if x['state_code']==band]
        items.sort(key=lambda x:(-x['attention_score'],x['project_code']))
        start=(page-1)*page_size
        return {'items':items[start:start+page_size],'total':len(items),'page':page,'page_size':page_size,'filters':{'states':sorted({x['state'] for x in items if x['state']}),'ministries':sorted({x['ministry'] for x in items if x['ministry']}),'sectors':sorted({x['sector'] for x in items if x['sector']})}}
@app.get('/api/v3/projects/{code}')
def project(code:str):
    with db() as con:
        p=project_by_code(con,code)
        if not p:raise HTTPException(404,detail={'code':'PROJECT_NOT_FOUND','message':'Project could not be found.'})
        item=current_item(con,p); hist=history_rows(con,p['id'])
        return {'project':item,'identity':{'project_code':p['project_code'],'legacy_ocms_code':p['legacy_ocms_code'],'pmgid':p['pmgid'],'match_note':'Identity continuity is anchored on reported project/legacy identifiers where available.'},
                'trajectory':{'items':[dict(x) for x in hist],'metrics':item['metrics']},'evidence':evidence(con,p),'recovery':historical_comparables(con,p),
                'intervention':dict(con.execute('select * from interventions where project_id=?',(p['id'],)).fetchone() or {}),'source':{'active_period':ACTIVE_REPORT_PERIOD,'portal':OFFICIAL_DASHBOARD_URL}}
@app.get('/api/v3/projects/{code}/timeline')
def timeline(code:str):
    with db() as con:
        p=project_by_code(con,code)
        if not p:raise HTTPException(404,'Project not found')
        return {'items':[dict(r) for r in history_rows(con,p['id'])]}
@app.get('/api/v3/projects/{code}/evidence')
def evidence_route(code:str):
    with db() as con:
        p=project_by_code(con,code)
        if not p:raise HTTPException(404,'Project not found')
        return evidence(con,p)
@app.get('/api/v3/projects/{code}/comparables')
def comparables(code:str):
    with db() as con:
        p=project_by_code(con,code)
        if not p:raise HTTPException(404,'Project not found')
        return historical_comparables(con,p)
@app.get('/api/v3/map')
def map_data():
    with db() as con:
        items=[current_item(con,p) for p in latest_rows(con)]; items=[x for x in items if x]
        states={}
        for x in items:
            st=x['state'] or 'Unspecified'; g=states.setdefault(st,{'state':st,'count':0,'exposure_crore':0,'original_cost_crore':0,'revised_cost_crore':0,'expenditure_crore':0,'completed':0,'ongoing':0,'avg_progress':[],'bands':{b:0 for b in ['STABLE','WATCH','PRESSURED','UNSTABLE','BREACH_RISK','BREACHED']},'lat':STATE_COORDS.get(st,(22.7,79.2))[0],'lng':STATE_COORDS.get(st,(22.7,79.2))[1]})
            g['count']+=1; g['exposure_crore']+=x['exposure_crore']; g['original_cost_crore']+=(safe_float(x['original_cost_crore']) or 0); g['revised_cost_crore']+=(safe_float(x['revised_cost_crore']) or 0); g['expenditure_crore']+=(safe_float(x['expenditure_crore']) or 0); g['completed']+=1 if (safe_float(x['physical_progress_pct']) or 0)>=100 else 0; g['ongoing']+=1 if (safe_float(x['physical_progress_pct']) or 0)<100 else 0; g['bands'][x['state_code']]+=1
            if x['physical_progress_pct'] is not None:g['avg_progress'].append(float(x['physical_progress_pct']))
        for g in states.values():g['avg_progress']=sum(g['avg_progress'])/len(g['avg_progress']) if g['avg_progress'] else None
        markers=[{'project_code':x['project_code'],'name':x['name'],'state':x['state'],'lat':x['latitude'],'lng':x['longitude'],'location_status':x['location_status'],'progress':x['physical_progress_pct'],'band':x['state_code'],'score':x['attention_score']} for x in items if x['latitude'] is not None and x['longitude'] is not None]
        return {'states':sorted(states.values(),key=lambda x:x['count'],reverse=True),'projects':markers,'note':'Project-level GPS is not supplied by the flash-report snapshot. Markers use state-centroid administrative context and are explicitly labelled as such.','coverage':{'mapped_context':len(markers),'without_location':len(items)-len(markers)}}
@app.get('/api/v3/integrity')
def integrity():
    with db() as con:
        counts=[dict(r) for r in con.execute('select rule_code,severity,count(*) count from integrity_flags f join project_snapshots s on s.id=f.snapshot_id where f.is_open=1 and s.report_period=? group by rule_code,severity order by count desc',(ACTIVE_REPORT_PERIOD,)).fetchall()]
        samples=[dict(r) for r in con.execute('''select p.project_code,p.name,p.state,f.rule_code,f.severity,f.message from integrity_flags f join project_snapshots s on s.id=f.snapshot_id join projects p on p.id=s.project_id where f.is_open=1 and s.report_period=? order by case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,f.id desc limit 80''',(ACTIVE_REPORT_PERIOD,)).fetchall()]
        return {'counts':counts,'samples':samples,'note':'Flags are deterministic data-quality checks. They are not proof of project failure.'}
@app.get('/api/v3/interventions')
def interventions():
    with db() as con:
        items=[current_item(con,p) for p in latest_rows(con)]
        rows=con.execute('select * from interventions').fetchall(); by={r['project_id']:dict(r) for r in rows}
        out=[]
        for x in items:
            p=con.execute('select id from projects where project_code=?',(x['project_code'],)).fetchone(); iv=by.get(p['id'],{})
            if x['attention_score']>=35 or iv:
                out.append({**x,'workflow_status':iv.get('status','FLAGGED'),'workflow_note':iv.get('note','')})
        out.sort(key=lambda x:(-x['attention_score'],x['project_code']))
        return {'items':out,'total':len(out)}
@app.post('/api/v3/projects/{code}/intervention')
def intervention(code:str,body:InterventionUpdate):
    if body.status not in ALLOWED_INTERVENTION:raise HTTPException(400,'Invalid workflow status')
    with db() as con:
        p=project_by_code(con,code)
        if not p:raise HTTPException(404,'Project not found')
        now=datetime.now(timezone.utc).isoformat(); old=con.execute('select * from interventions where project_id=?',(p['id'],)).fetchone()
        if old:
            con.execute('update interventions set status=?,note=?,updated_at=? where project_id=?',(body.status,body.note,now,p['id'])); iid=old['id']; from_status=old['status']
        else:
            con.execute('insert into interventions(project_id,status,note,created_at,updated_at) values(?,?,?,?,?)',(p['id'],body.status,body.note,now,now)); iid=con.execute('select last_insert_rowid()').fetchone()[0]; from_status=None
        con.execute('insert into intervention_events(intervention_id,from_status,to_status,note,created_at) values(?,?,?,?,?)',(iid,from_status,body.status,body.note,now)); log(con,'INTERVENTION_STATUS_CHANGED','project',p['project_code'],{'from':from_status,'to':body.status}); con.commit()
        return {'status':body.status,'note':body.note}
@app.post('/api/v3/sync')
def sync():
    # The assessment build is intentionally frozen. A sync checks the contract and records
    # an audit event; it cannot silently promote a newer report into the April-as-of view.
    with db() as con:
        now=datetime.now(timezone.utc).isoformat(); log(con,'SOURCE_CHECK','source',ACTIVE_REPORT_PERIOD,{'mode':'frozen_as_of','active_period':ACTIVE_REPORT_PERIOD}); con.commit()
        return {'status':'checked','mode':'frozen_as_of','active_report_period':ACTIVE_REPORT_PERIOD,'message':f'Official-source contract checked. Historical snapshots remain bundled in the Sentinel database and the active assessment remains frozen at {ACTIVE_REPORT_PERIOD}; newer reports are not promoted into this build.'}
@app.get('/api/v3/engine/audit')
def audit():
    with db() as con:
        latest=portfolio(con); return {'mode':'rule_based_attention','model_status':'NO_PRODUCTION_PROBABILITY_MODEL','attention_semantics':'Transparent portfolio-attention state, not a calibrated probability.','active_period':ACTIVE_REPORT_PERIOD,'history_periods':latest['project_count'],'evidence_contract':'observed / derived / integrity / source'}
@app.post('/api/v3/ai/query')
def ai(body:AIQuery):
    q=body.question.strip(); low=q.lower()
    with db() as con:
        m=re.search(r'\b(\d{6,9}|N\d{7,10})\b',q,re.I)
        if m:
            p=project_by_code(con,m.group(1));
            if p:
                item=current_item(con,p)
                return {'answer':f"{item['name']} ({item['project_code']}) is at {item['physical_progress_pct'] if item['physical_progress_pct'] is not None else 'unknown'}% reported progress in April 2026. Sentinel state: {item['state_code']}. Required monthly progress is {item['metrics']['required_monthly_progress_pct']:.1f} points/month." if item['metrics']['required_monthly_progress_pct'] is not None else f"{item['name']} ({item['project_code']}) is at {item['physical_progress_pct'] if item['physical_progress_pct'] is not None else 'unknown'}% reported progress in April 2026.",'evidence':evidence(con,p)}
        items=[current_item(con,p) for p in latest_rows(con)]
        if 'tamil' in low:
            items=[x for x in items if x['state']=='Tamil Nadu']
        if 'unstable' in low: items=[x for x in items if x['state_code'] in {'UNSTABLE','BREACH_RISK','BREACHED'}]
        if 'pressure' in low: items=[x for x in items if x['state_code'] in {'PRESSURED','UNSTABLE','BREACH_RISK','BREACHED'}]
        items.sort(key=lambda x:-x['attention_score'])
        if not items:return {'answer':'No verified project records matched that query in the April 2026 snapshot.','evidence':{'source':{'report_period':ACTIVE_REPORT_PERIOD}}}
        top=items[:10]
        return {'answer':f"I found {len(items)} matching project records in the April 2026 snapshot. The highest-attention records in that filtered set are: " + '; '.join(f"{x['project_code']} — {x['name'][:55]} ({x['state_code']}, {x['attention_score']:.0f}/100)" for x in top),'evidence':{'items':[{'project_code':x['project_code'],'name':x['name'],'state':x['state'],'attention_state':x['state_code'],'attention_score':x['attention_score']} for x in top],'source':{'report_period':ACTIVE_REPORT_PERIOD,'basis':'structured Sentinel query'}}}
@app.get('/api/v3/export.csv')
def export_csv():
    with db() as con:
        items=[current_item(con,p) for p in latest_rows(con)]
    fields=['project_code','name','ministry','agency','sector','state','physical_progress_pct','original_cost_crore','revised_cost_crore','expenditure_crore','revised_end_date','attention_score','state_code','required_monthly_progress_pct','velocity_recent_pct_per_month','commitment_revisions','exposure_crore']
    buf=io.StringIO(); w=csv.DictWriter(buf,fieldnames=fields); w.writeheader()
    for x in items:
        row={k:x.get(k) for k in fields}; row['required_monthly_progress_pct']=x['metrics'].get('required_monthly_progress_pct'); row['velocity_recent_pct_per_month']=x['metrics'].get('velocity_recent_pct_per_month'); row['commitment_revisions']=x['metrics'].get('commitment_revisions'); w.writerow(row)
    return StreamingResponse(iter([buf.getvalue()]),media_type='text/csv',headers={'Content-Disposition':f'attachment; filename=paimana_sentinel_{ACTIVE_REPORT_PERIOD}.csv'})
