import type {Comparable, Evidence, EngineAudit, MapProjectPoint, Portfolio, Project, StateAggregate, TimelineItem, TrajectoryIntelligence} from './types'

const API_BASE = (import.meta.env.VITE_API_URL || '/api/v3').replace(/\/$/,'')

async function request<T>(path:string, options?:RequestInit):Promise<T>{
  const r=await fetch(`${API_BASE}${path}`,options)
  if(!r.ok){
    let message=`Request failed (${r.status})`
    try{const body=await r.json(); message=body?.detail?.message||body?.detail||body?.message||message}catch{}
    throw new Error(String(message))
  }
  return r.json() as Promise<T>
}

function normalizeBand(b:string|undefined|null):Project['assessment_band']{
  switch(b){
    case 'BREACHED': return 'critical'
    case 'BREACH_RISK': return 'high'
    case 'UNSTABLE': return 'high'
    case 'PRESSURED': return 'elevated'
    case 'WATCH': return 'watch'
    case 'STABLE': return 'low'
    default:return 'unknown'
  }
}

function normalizeProject(p:any):Project{
  const assessmentBand=normalizeBand(p?.state_code)
  const attention=typeof p?.attention_score==='number'?p.attention_score:null
  const progress=typeof p?.physical_progress_pct==='number'?p.physical_progress_pct:null
  return {
    ...p,
    risk_band:assessmentBand,
    assessment_score:attention==null?null:attention/100,
    assessment_band:assessmentBand,
    priority_score:attention,
    priority_band:assessmentBand,
    breach_probability:null,
    assessment_semantics:'Transparent Sentinel attention state derived from reported project trajectory, commitments, cost and data-integrity rules; not a calibrated probability.',
    assessment_components:{},
    reference_class:null,
    derived:{
      progress_delta_pct:null,
      months_remaining:p?.metrics?.months_remaining ?? null,
      required_monthly_progress_pct:p?.metrics?.required_monthly_progress_pct ?? null,
      revision_count_to_date:p?.metrics?.commitment_revisions ?? null,
    },
    reasons:Array.isArray(p?.reasons)?p.reasons:[],
    physical_progress_pct:progress,
  }
}

function normalizeEvidence(raw:any):Evidence{
  // v3 intentionally returns structured evidence; expose it in the richer UI contract.
  const observed:any[] = []
  const derived:any[] = []
  const historical:any[] = []
  const model:any[] = []
  const describe=(x:any)=>{
    if(typeof x==='string') return x
    if(x==null) return ''
    if(x.label && x.value!==undefined) return `${x.label}: ${x.value}${x.unit?` ${x.unit}`:''}`
    if(x.rule_code && x.message) return `${String(x.rule_code).replaceAll('_',' ')}: ${x.message}`
    return x.message||x.observation||JSON.stringify(x)
  }
  if(Array.isArray(raw?.observed)) observed.push(...raw.observed.map(describe).filter(Boolean))
  if(Array.isArray(raw?.derived)) derived.push(...raw.derived.map(describe).filter(Boolean))
  if(Array.isArray(raw?.integrity)) derived.push(...raw.integrity.map(describe).filter(Boolean))
  if(Array.isArray(raw?.historical)) historical.push(...raw.historical.map(describe).filter(Boolean))
  if(raw?.model_output) model.push(String(raw.model_output))
  // When the endpoint exposes a compact object, surface its string values as facts.
  for(const [k,v] of Object.entries(raw||{})){
    if(['observed','derived','integrity','historical','model_output','provenance'].includes(k)) continue
    if(v==null||typeof v==='object') continue
    observed.push(`${k.replaceAll('_',' ')}: ${v}`)
  }
  return {observed_facts:observed,derived_indicators:derived,model_output:model,historical_evidence:historical,provenance:raw?.provenance||{}}
}

function buildTrajectory(items:TimelineItem[], project:Project|null):TrajectoryIntelligence{
  const series=items.filter(x=>x.physical_progress_pct!=null).map(x=>({report_period:x.report_period,physical_progress_pct:x.physical_progress_pct}))
  const deltas:any[]=[]
  for(let i=1;i<series.length;i++){
    const a=series[i-1],b=series[i]
    const delta=(b.physical_progress_pct??0)-(a.physical_progress_pct??0)
    deltas.push({from_period:a.report_period,to_period:b.report_period,elapsed_months:1,progress_delta_pct:delta,monthly_velocity_pct:delta})
  }
  const positive=deltas.filter(x=>x.progress_delta_pct>0).length
  const zero=deltas.filter(x=>x.progress_delta_pct===0).length
  const negative=deltas.filter(x=>x.progress_delta_pct<0).length
  const velocities=deltas.map(x=>x.monthly_velocity_pct)
  const mean=velocities.length?velocities.reduce((a,b)=>a+b,0)/velocities.length:null
  const latest=velocities.length?velocities[velocities.length-1]:null
  let longest=0,run=0
  for(const d of deltas){if(d.progress_delta_pct===0){run++;longest=Math.max(longest,run)}else run=0}
  return {
    project:project,
    trajectory:{
      history_length:items.length,report_periods:items.map(x=>x.report_period),physical_progress_series:series.map(x=>({report_period:x.report_period,physical_progress_pct:x.physical_progress_pct??null})),progress_deltas:deltas,
      mean_monthly_velocity:mean,latest_monthly_velocity:latest,velocity_change:velocities.length>1?velocities[velocities.length-1]-velocities[velocities.length-2]:null,
      longest_stagnation_run_months:longest,trend_direction:latest==null?'unknown':latest>0?'improving':latest<0?'declining':'flat',
      positive_progress_periods:positive,zero_progress_periods:zero,negative_progress_periods:negative,
      maximum_progress_gain:deltas.length?Math.max(...deltas.map(x=>x.progress_delta_pct)):null,
      maximum_progress_drop:deltas.length?Math.min(...deltas.map(x=>x.progress_delta_pct)):null,
      commitment_revision_count:project?.metrics?.commitment_revisions??0,
      cumulative_commitment_revision_magnitude_months:0,
      first_revised_end_date:items.find(x=>x.revised_end_date)?.revised_end_date||null,
      latest_revised_end_date:items.length?items[items.length-1].revised_end_date||null:null,
      commitment_revisions:[],
      trajectory_data_quality:{status:items.length?'available':'insufficient',history_length:items.length,progress_observation_count:series.length,has_gaps:false,missing_report_months:[],missing_progress_periods:[]}
    },
    anomalies:[
      ...deltas.filter(x=>x.progress_delta_pct<0).map(x=>({type:'reversal',from_period:x.from_period,to_period:x.to_period,value:x.progress_delta_pct,unit:'percentage points',status:'observed'})),
      ...(longest>1?[{type:'stagnation',value:longest,unit:'months',status:'observed'}]:[])
    ],
    evidence:[],
    source:{latest_report_period:project?.report_period||null,reporting_cutoff:project?.reporting_cutoff||null,source_type:'PAIMANA Flash Report'},
    matches:[],method:{type:'deterministic_timeline_from_v3'},data_sufficiency:{history_length:items.length}
  }
}

export interface PortfolioChanges{
  current_period:string|null; previous_period:string|null;
  summary:{projects_current?:number;progress_moved?:number;positive_progress?:number;negative_progress?:number;stagnant_progress?:number;completion_revised?:number;cost_revised?:number};
  projects?:Array<any>
}
export interface PortfolioTrends{periods:Array<any>}

export const client={
  health:()=>request<any>('/health'),
  source:async()=>{
    const [s,m]=await Promise.all([request<any>('/source'),request<any>('/meta')])
    const current=s?.current||{}
    const releases=s?.releases||[]
    return {
      ...s,
      history:{...(m?.history||{}),source_releases:releases.length,reporting_periods:m?.history?.periods??m?.history?.reporting_periods??0},
      periods:m?.periods||[],
      latest_report:{
        source_name:current.source_name||'PAIMANA Monthly Flash Report',report_period:current.report_period||s?.active_period||null,
        reporting_cutoff:current.reporting_cutoff||s?.freshness?.data_cutoff||null,published_at:current.published_at||null,
        row_count:current.row_count||null,file_sha256:current.file_sha256||null,source_url:current.source_url||null
      },
      official_dashboard_url:m?.official_dashboard_url||'https://paimana-proj.mospi.gov.in/',
      reports_url:m?.official_reports_url||'https://paimana-proj.mospi.gov.in/',
      sync:{status:'frozen_as_of',message:'Active assessment is frozen at April 2026. Historical snapshots are already bundled.',last_run:null}
    }
  },
  portfolio:async()=>{
    const p:any=await request<any>('/portfolio')
    const bands=p.attention_bands||{}
    const elevatedOrHigher=(bands.PRESSURED||0)+(bands.UNSTABLE||0)+(bands.BREACH_RISK||0)+(bands.BREACHED||0)
    return {
      ...p,
      // Keep the normalized summary where the UI contract expects it while
      // preserving the backend's individual state counts for detailed views.
      attention_bands:{
        ...bands,
        elevated_or_higher:elevatedOrHigher,
        high:(bands.BREACH_RISK||0)+(bands.BREACHED||0),
        critical:bands.BREACHED||0,
      },
      source_mode:p.data_mode||'FROZEN_AS_OF',
      model_note:'Transparent rule-based attention states; not a calibrated probability model.',
    } as Portfolio
  },
  queue:async()=>{
    const r=await client.projects({page:1,page_size:200})
    return {items:r.items.filter(p=>(p.priority_score??0)>=35),policy:'attention_score',total:r.items.filter(p=>(p.priority_score??0)>=35).length}
  },
  projects:async(params:Record<string,string|number|undefined>)=>{
    // v3 caps page_size at 200. Pull every page so the UI never silently truncates the April portfolio.
    const requested=Number(params.page_size||200); const pageSize=Math.min(Math.max(requested,1),200)
    const first=await request<any>(`/projects?${new URLSearchParams(Object.entries({...params,page:1,page_size:pageSize}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))}`)
    let items=(first.items||[]).map(normalizeProject)
    const total=Number(first.total||items.length)
    const pages=Math.ceil(total/pageSize)
    if(pages>1){
      const rest=await Promise.all(Array.from({length:pages-1},(_,i)=>request<any>(`/projects?${new URLSearchParams(Object.entries({...params,page:i+2,page_size:pageSize}).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))}`)))
      for(const r of rest) items.push(...(r.items||[]).map(normalizeProject))
    }
    return {items,total,states:first.filters?.states||[],sectors:first.filters?.sectors||[]}
  },
  project:async(c:string)=>{const r:any=await request<any>(`/projects/${encodeURIComponent(c)}`);const p=normalizeProject(r.project); return {project:p,snapshot:r}},
  timeline:async(c:string)=>request<any>(`/projects/${encodeURIComponent(c)}/timeline`) as Promise<{items:TimelineItem[]}>,
  comparables:async(c:string)=>{
    const r:any=await request<any>(`/projects/${encodeURIComponent(c)}/comparables`)
    const matches=(r.matches||[]).map((x:any)=>({...x,similarity_components:{},similarity_type:'historical_match',common_interval_count:0,match_reasons:[],trajectory:buildTrajectory([],null).trajectory,evidence:[]})) as Comparable[]
    return {matches,method:{type:'historical_comparable'},data_sufficiency:{cohort_size:r.cohort_size,plausibility:r.plausibility}}
  },
  trajectory:async(c:string)=>{const [p,t]=await Promise.all([client.project(c),client.timeline(c)]);return buildTrajectory(t.items,p.project)},
  evidence:async(c:string)=>{const r=await request<any>(`/projects/${encodeURIComponent(c)}/evidence`);return normalizeEvidence(r)},
  map:async()=>{
    const m:any=await request<any>('/map')
    const states=(m.states||[]).map((s:any)=>({
      ...s, original_cost_crore:s.original_cost_crore??null, revised_cost_crore:s.revised_cost_crore??null, expenditure_crore:s.expenditure_crore??null, completed:s.completed??0, ongoing:s.ongoing??s.count,
      critical:s.bands?.BREACHED||0, high:(s.bands?.BREACH_RISK||0)+(s.bands?.UNSTABLE||0), elevated:s.bands?.PRESSURED||0, watch:s.bands?.WATCH||0, low:s.bands?.STABLE||0,
      lat:s.lat,lng:s.lng,
    })) as StateAggregate[]
    const projects=(m.projects||[]).map((p:any)=>({project_code:p.project_code,name:p.name,state:p.state,latitude:null,longitude:null,location_status:p.location_status,physical_progress_pct:p.progress,breach_probability:null,assessment_score:typeof p.score==='number'?p.score/100:null,assessment_band:normalizeBand(p.band),risk_band:normalizeBand(p.band),exposure_crore:null,map_latitude:p.lat,map_longitude:p.lng,placement:p.location_status||'state_centroid'})) as MapProjectPoint[]
    const audit:any=await request<any>('/engine/audit').catch(()=>null)
    const scores=projects.map(p=>p.assessment_score).filter((x):x is number=>typeof x==='number')
    const bandCounts:Record<string,number>={}
    for(const p of projects){const k=p.assessment_band||'unknown';bandCounts[k]=(bandCounts[k]||0)+1}
    const locationCoverage={exact_gps:projects.filter(p=>p.location_status==='exact_gps').length,state_context:projects.filter(p=>p.location_status && p.location_status!=='exact_gps' && p.location_status!=='unavailable').length,unavailable:projects.filter(p=>p.location_status==='unavailable'||!p.location_status).length}
    return {state_aggregates:states,projects,engine_audit:{engine_name:'Sentinel Attention Engine',engine_version:'4.0.0',engine_code_hash:'',evaluation_period:m.active_period||null,total_latest_projects:projects.length,evaluated_count:projects.length,coverage_pct:projects.length?100:0,attention_count:projects.filter(p=>p.assessment_score!=null&&p.assessment_score>=.35).length,band_counts:bandCounts,score_range:{min:scores.length?Math.min(...scores):null,max:scores.length?Math.max(...scores):null,mean:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null},result_checksum:'',deterministic:true,ml_status:audit?.model_status||'NO_PRODUCTION_PROBABILITY_MODEL',method:audit?.attention_semantics||'Rule-based attention state',location_coverage:locationCoverage},marker_note:m.note||'',basemaps:['roads','terrain','satellite','hybrid']}
  },
  engineAudit:()=>request<any>('/engine/audit'),
  integrity:async()=>{const r:any=await request<any>('/integrity');return {open_flags:Object.fromEntries((r.counts||[]).map((x:any)=>[x.rule_code,x.count])),samples:r.samples||[]}},
  citizen:async(c:string,_language:string)=>{const r:any=await request<any>(`/projects/${encodeURIComponent(c)}`);const p=normalizeProject(r.project);return {project:p,status:{physical_progress_pct:p.physical_progress_pct,revised_cost_crore:p.revised_cost_crore,expenditure_crore:p.expenditure_crore,expected_completion:p.revised_end_date},source:{report_period:p.report_period}}},
  ai:(question:string,_language='en')=>request<any>('/ai/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question})}),
  sync:(mode='latest')=>request<any>('/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode})}),
  changes:async(includeProjects=true)=>request<any>(`/portfolio/changes?include_projects=${includeProjects?'true':'false'}`),
  trends:async()=>{const r:any=await request<any>('/portfolio/trends');return {periods:(r.items||[]).map((x:any)=>({report_period:x.report_period,projects:x.projects,avg_progress:x.avg_progress,original_cost_crore:null,revised_cost_crore:x.revised_cost_crore,expenditure_crore:x.expenditure_crore}))}},
  exportCsv:()=>window.open(`${API_BASE}/export.csv`,'_blank','noopener,noreferrer'),
  intervention:(c:string,status:string,note='')=>request<any>(`/projects/${encodeURIComponent(c)}/intervention`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status,note})}),
}

export const api=client
