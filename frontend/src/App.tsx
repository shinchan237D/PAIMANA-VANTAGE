import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import L from 'leaflet'
import {Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts'
import {
  Activity, AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Bot, Check,
  ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, Database, Download, ExternalLink,
  FileCheck2, FileText, Filter, Gauge, GitCompareArrows, Globe2, Layers3, Landmark, Menu, MessageSquareText,
  Minus, MonitorCheck, PanelRightOpen, RefreshCw, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles,
  Target, TrendingDown, TrendingUp, Users, X, Map as MapIcon, Table2, Workflow, Zap, CalendarClock, Eye
} from 'lucide-react'
import {client, type PortfolioChanges, type PortfolioTrends} from './api'
import type {Comparable, Evidence, EngineAudit, MapProjectPoint, Portfolio, Project, RiskBand, StateAggregate, TimelineItem, TrajectoryIntelligence} from './types'

type View='overview'|'map'|'watchlist'|'projects'|'trajectory'|'stress'|'trends'|'compare'|'trust'|'sources'|'analyst'|'brief'|'project'|'citizen'
type Base='roads'|'terrain'|'satellite'|'hybrid'
type QueueTab='all'|'attention'|'stagnation'|'commitment'|'trust'|'recovery'

type Notice={kind:'success'|'error'|'info';text:string}
type SystemStatus='checking'|'online'|'offline'

const bases:Record<Base,{label:string;tiles:string;attr:string}>={
  roads:{label:'Roads',tiles:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',attr:'© OpenStreetMap contributors'},
  terrain:{label:'Terrain',tiles:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',attr:'© OpenStreetMap contributors, SRTM | OpenTopoMap'},
  satellite:{label:'Satellite',tiles:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attr:'© Esri'},
  hybrid:{label:'Hybrid',tiles:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attr:'© Esri'}
}
const stateCenters:Record<string,[number,number]>={
  'Andhra Pradesh':[15.9129,79.74],'Arunachal Pradesh':[28.218,94.7278],'Assam':[26.2006,92.9376],'Bihar':[25.0961,85.3131],
  Chhattisgarh:[21.2787,81.8661],Delhi:[28.6139,77.209],Goa:[15.2993,74.124],Gujarat:[22.2587,71.1924],
  Haryana:[29.0588,76.0856],'Himachal Pradesh':[31.1048,77.1734],Jharkhand:[23.6102,85.2799],Karnataka:[15.3173,75.7139],
  Kerala:[10.8505,76.2711],'Madhya Pradesh':[22.9734,78.6569],Maharashtra:[19.7515,75.7139],Manipur:[24.6637,93.9063],
  Meghalaya:[25.467,91.3662],Mizoram:[23.1645,92.9376],Nagaland:[26.1584,94.5624],Odisha:[20.9517,85.0985],
  Punjab:[31.1471,75.3412],Rajasthan:[27.0238,74.2179],Sikkim:[27.533,88.5122],'Tamil Nadu':[11.1271,78.6569],
  Telangana:[18.1124,79.0193],Tripura:[23.9408,91.9882],'Uttar Pradesh':[26.8467,80.9462],Uttarakhand:[30.0668,79.0193],
  'West Bengal':[22.9868,87.855],'Jammu & Kashmir':[33.7782,76.5762],Ladakh:[34.1526,77.577],Puducherry:[11.9416,79.8083]
}

const fmtInt=(n?:number|null)=>n==null?'—':Number(n).toLocaleString('en-IN')
const fmtNum=(n?:number|null,d=1)=>n==null?'—':Number(n).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d})
const money=(n?:number|null)=>n==null?'—':`₹${Number(n).toLocaleString('en-IN',{maximumFractionDigits:0})} Cr`
const moneyCompact=(n?:number|null)=>n==null?'—':Math.abs(Number(n))>=100000?`₹${(Number(n)/100000).toFixed(1)}L Cr`:Math.abs(Number(n))>=1000?`₹${(Number(n)/1000).toFixed(1)}k Cr`:money(n)
const pct=(n?:number|null,d=1)=>n==null?'—':`${Number(n).toFixed(d)}%`
const dateFmt=(d?:string|null)=>d?new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'
const score=(p?:number|null)=>p==null?null:Math.round(Number(p)*100)
const band=(p?:number|null):RiskBand=>{const x=p??0;return x>=.8?'critical':x>=.65?'high':x>=.5?'elevated':x>=.3?'watch':'low'}
const bandLabel=(b?:RiskBand|null)=>!b?'Unknown':b[0].toUpperCase()+b.slice(1)
const referenceClassLabel=(x?:{type:string;label?:string;peer_count?:number}|null)=>{if(!x)return null; if(x.type==='ministry_state')return 'Ministry + state peers'; if(x.type==='ministry')return 'Ministry peer cohort'; return 'National peer cohort'}
const normalize=(s:string)=>s.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'')
const clamp=(n:number,a=0,b=100)=>Math.max(a,Math.min(b,n))

const viewMeta:Record<View,{section:string;label:string;stage?:number;hint:string}>={
  overview:{section:'COMMAND CENTRE',label:'National Overview',stage:1,hint:'Start here · portfolio-wide signal surface'},
  map:{section:'COMMAND CENTRE',label:'Portfolio Map',stage:2,hint:'Locate · spatial project context'},
  watchlist:{section:'COMMAND CENTRE',label:'Sentinel Watchlist',stage:2,hint:'Triage · prioritised project signals'},
  projects:{section:'INTELLIGENCE',label:'All Projects',hint:'Explore · complete latest project register'},
  trajectory:{section:'INTELLIGENCE',label:'Trajectory Analysis',stage:3,hint:'Diagnose · longitudinal progress movement'},
  stress:{section:'INTELLIGENCE',label:'Commitment Stress',stage:3,hint:'Diagnose · required recovery rate'},
  trends:{section:'INTELLIGENCE',label:'Portfolio Trends',hint:'Compare · portfolio movement over time'},
  compare:{section:'INTELLIGENCE',label:'Project Comparison',stage:4,hint:'Contextualise · peer-relative comparison'},
  trust:{section:'EVIDENCE & TRUST',label:'Data Trust Center',hint:'Verify · coverage and data lineage'},
  sources:{section:'EVIDENCE & TRUST',label:'Source & Releases',hint:'Verify · reporting source layer'},
  analyst:{section:'ANALYTICAL TOOLS',label:'Sentinel Analyst',hint:'Ask · grounded portfolio questions'},
  brief:{section:'ANALYTICAL TOOLS',label:'National Monitoring Brief',stage:4,hint:'Brief · decision-ready reporting'},
  project:{section:'INVESTIGATION',label:'Project Intelligence',stage:3,hint:'Investigate · evidence, trajectory, commitment'},
  citizen:{section:'PUBLIC VIEW',label:'Public Project View',hint:'Public facts · reported project status'},
}

function App(){
  const [view,setView]=useState<View>('overview')
  const [sideOpen,setSideOpen]=useState(()=>typeof window!=='undefined' ? window.innerWidth>760 : true)
  const [portfolio,setPortfolio]=useState<Portfolio|null>(null)
  const [queue,setQueue]=useState<Project[]>([])
  const [projects,setProjects]=useState<Project[]>([])
  const [mapStates,setMapStates]=useState<StateAggregate[]>([])
  const [mapProjects,setMapProjects]=useState<MapProjectPoint[]>([])
  const [mapAudit,setMapAudit]=useState<EngineAudit|null>(null)
  const [mapNote,setMapNote]=useState('')
  const [integrity,setIntegrity]=useState<{open_flags:Record<string,number>;samples:any[]}>({open_flags:{},samples:[]})
  const [source,setSource]=useState<any>(null)
  const [changes,setChanges]=useState<PortfolioChanges|null>(null)
  const [trends,setTrends]=useState<PortfolioTrends|null>(null)
  const [selected,setSelected]=useState<Project|null>(null)
  const [timeline,setTimeline]=useState<TimelineItem[]>([])
  const [trajectory,setTrajectory]=useState<TrajectoryIntelligence|null>(null)
  const [comparables,setComparables]=useState<Comparable[]>([])
  const [evidence,setEvidence]=useState<Evidence|null>(null)
  const [comparison,setComparison]=useState<Project[]>([])
  const [citizen,setCitizen]=useState<any>(null)
  const [lang,setLang]=useState<'en'|'hi'|'ta'>('en')
  const [loading,setLoading]=useState(true)
  const [refreshing,setRefreshing]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [notice,setNotice]=useState<Notice|null>(null)
  const [systemStatus,setSystemStatus]=useState<SystemStatus>('checking')
  const [lastLoadedAt,setLastLoadedAt]=useState<number|null>(null)
  const [projectLoading,setProjectLoading]=useState(false)
  const [analystOpen,setAnalystOpen]=useState(false)
  const [searchOpen,setSearchOpen]=useState(false)
  const [globalSearch,setGlobalSearch]=useState('')
  const [whyOpen,setWhyOpen]=useState(false)
  const [demoOpen,setDemoOpen]=useState(false)
  const [projectOrigin,setProjectOrigin]=useState<View>('watchlist')
  const loadInFlight=useRef(false)

  const loadAll=useCallback(async()=>{
  if(loadInFlight.current)return
  loadInFlight.current=true
  setError(null)

  try{
    // Load essential dashboard data first.
    const [p,m,i,s,c,t]=await Promise.all([
      client.portfolio(),
      client.map(),
      client.integrity(),
      client.source(),
      client.changes(false),
      client.trends()
    ])

    setPortfolio(p)
    setMapStates(m.state_aggregates)
    setMapProjects(m.projects||[])
    setMapAudit(m.engine_audit||null)
    setMapNote(m.marker_note||'')
    setIntegrity(i)
    setSource(s)
    setChanges(c)
    setTrends(t)

    // IMPORTANT: show the dashboard now.
    setLoading(false)
    setSystemStatus('online')
    setLastLoadedAt(Date.now())

    // Load the complete project register in the background.
    client.projects({
      page:1,
      page_size:200,
      sort:'risk'
    }).then(pr=>{
      setQueue(pr.items)
      setProjects(pr.items)
    }).catch(e=>{
      console.error('Project register background load failed:',e)
    })

  }catch(e){
    setLoading(false)
    setSystemStatus('offline')
    setError(
      e instanceof Error
        ? e.message
        : 'Unable to connect to the Sentinel backend.'
    )
  }finally{
    loadInFlight.current=false
  }
},[])
  
  const openProject=useCallback(async(projectOrCode:Project|string)=>{
    const code=typeof projectOrCode==='string'?projectOrCode:projectOrCode.project_code
    const base=typeof projectOrCode==='string'?projects.find(p=>p.project_code===code)||null:projectOrCode
    if(base) setSelected(base)
    if(view!=='project' && view!=='citizen') setProjectOrigin(view)
    setView('project')
    setWhyOpen(false)
    setProjectLoading(true)
    try{
      const [detail,t,c,tr,e]=await Promise.all([client.project(code),client.timeline(code),client.comparables(code),client.trajectory(code),client.evidence(code)])
      setSelected(detail.project); setTimeline(t.items); setComparables(c.matches||[]); setTrajectory(tr); setEvidence(e)
    }catch(e){setNotice({kind:'error',text:e instanceof Error?e.message:'Project detail could not be loaded.'})}
    finally{setProjectLoading(false)}
  },[projects,view])

  const toggleCompare=useCallback((p:Project)=>setComparison(curr=>{
    const exists=curr.some(x=>x.project_code===p.project_code)
    if(exists)return curr.filter(x=>x.project_code!==p.project_code)
    if(curr.length>=2)return [curr[1],p]
    return [...curr,p]
  }),[])

  const runSync=async()=>{
    setRefreshing(true); setNotice({kind:'info',text:'Checking the official source and refreshing the newest report…'})
    try{await client.sync('latest'); await loadAll(); setNotice({kind:'success',text:'Latest-source check completed. Portfolio data refreshed.'})}
    catch(e){setNotice({kind:'error',text:e instanceof Error?e.message:'Source check failed.'})}
    finally{setRefreshing(false)}
  }

  const runBackfill=async()=>{
    setRefreshing(true); setNotice({kind:'info',text:'The April assessment build already contains its bundled historical snapshots. Checking the source contract without changing the active report…'})
    try{
      const result=await client.sync('backfill')
      await loadAll()
      setNotice({kind:'success',text:result?.message||'Source contract checked. Stored history remains available and April stays the active assessment snapshot.'})
    }catch(e){setNotice({kind:'error',text:e instanceof Error?e.message:'Source check failed.'})}
    finally{setRefreshing(false)}
  }

  const openCitizen=async()=>{
    if(!selected)return
    try{setCitizen(await client.citizen(selected.project_code,lang));setView('citizen')}catch(e){setNotice({kind:'error',text:e instanceof Error?e.message:'Public project view could not be loaded.'})}
  }


  const nav=(v:View)=>{setView(v);if(typeof window!=='undefined' && window.innerWidth<=760)setSideOpen(false);window.scrollTo({top:0,behavior:'smooth'})}
  const resetDemo=()=>{setWhyOpen(false);setDemoOpen(false);setSelected(null);setTimeline([]);setTrajectory(null);setComparables([]);setEvidence(null);setProjectOrigin('watchlist');nav('overview')}

  return <div className="sentinel-app">
    <Topbar systemStatus={systemStatus} lastLoadedAt={lastLoadedAt} portfolio={portfolio} onToggle={()=>setSideOpen(v=>!v)} onSync={runSync} refreshing={refreshing} onSearch={()=>setSearchOpen(true)} onAI={()=>setAnalystOpen(true)} onBrief={()=>nav('brief')} onDemo={()=>setDemoOpen(true)} />
    <div className="app-body">
      <Sidebar open={sideOpen} view={view} comparisonCount={comparison.length} latestReport={portfolio?.report_period} history={source?.history} onNavigate={nav} onAI={()=>setAnalystOpen(true)} />
      <main className="content-area">
        <div key={view} className="view-transition">
        {error && <ErrorBanner message={error} onRetry={loadAll}/>} 
        {notice && <Toast notice={notice} onClose={()=>setNotice(null)}/>} 
        {loading ? <LoadingPage/> : <>
          {view!=='citizen' && <ViewContextBar view={view} portfolio={portfolio} selected={selected}/>}
          {view==='overview' && <OverviewPage portfolio={portfolio} projects={projects} queue={queue} changes={changes} integrity={integrity} source={source} mapStates={mapStates} mapProjects={mapProjects} audit={mapAudit} mapNote={mapNote} open={openProject} onMap={()=>nav('map')} onWatchlist={()=>nav('watchlist')} onBrief={()=>nav('brief')} />}
          {view==='map' && <MapPage states={mapStates} projects={mapProjects} allProjects={projects} audit={mapAudit} note={mapNote} onOpen={openProject} onBack={()=>nav('overview')} />}
          {view==='watchlist' && <WatchlistPage queue={queue} projects={projects} integrity={integrity} onOpen={openProject} onCompare={toggleCompare} />}
          {view==='projects' && <ProjectsPage projects={projects} states={mapStates.map(s=>s.state)} onOpen={openProject} onCompare={toggleCompare} onExport={client.exportCsv}/>} 
          {view==='trajectory' && <TrajectoryLibraryPage projects={projects} onOpen={openProject}/>} 
          {view==='stress' && <StressLibraryPage projects={projects} onOpen={openProject}/>} 
          {view==='trends' && <TrendsPage trends={trends} changes={changes}/>} 
          {view==='compare' && <ComparePage projects={projects} selected={comparison} setSelected={setComparison} onOpen={openProject}/>} 
          {view==='trust' && <TrustPage integrity={integrity} source={source} audit={mapAudit} onSync={runSync} onBackfill={runBackfill} refreshing={refreshing}/>} 
          {view==='sources' && <SourcesPage source={source} onSync={runSync} onBackfill={runBackfill} refreshing={refreshing}/>} 
          {view==='analyst' && <AnalystPage lang={lang} setLang={setLang}/>} 
          {view==='brief' && <BriefPage portfolio={portfolio} changes={changes} audit={mapAudit} source={source} projects={projects} onExport={client.exportCsv}/>} 
          {view==='project' && selected && <ProjectPage project={selected} loading={projectLoading} timeline={timeline} trajectory={trajectory} comparables={comparables} evidence={evidence} onBack={()=>nav(projectOrigin)} onCompare={()=>toggleCompare(selected)} comparing={comparison.some(p=>p.project_code===selected.project_code)} onCitizen={openCitizen} onWhy={()=>setWhyOpen(true)} />} 
          {view==='citizen' && selected && citizen && <CitizenPage project={selected} data={citizen} lang={lang} setLang={setLang} onBack={()=>setView('project')}/>} 
        </>}
        </div>
      </main>
    </div>
    {analystOpen && <AnalystDrawer onClose={()=>setAnalystOpen(false)} lang={lang}/>} 
    {demoOpen && <DemoGuide onClose={()=>setDemoOpen(false)} onNavigate={(v)=>{setDemoOpen(false);nav(v)}} onOpenProject={(p)=>{setDemoOpen(false);openProject(p)}} onReset={resetDemo} currentView={view} project={selected||queue[0]||projects[0]||null}/>}
    {searchOpen && <GlobalSearch projects={projects} query={globalSearch} setQuery={setGlobalSearch} onClose={()=>setSearchOpen(false)} onOpen={openProject} onNavigate={nav}/>} 
    {whyOpen && selected && <WhyDrawer project={selected} evidence={evidence} trajectory={trajectory} onClose={()=>setWhyOpen(false)} />}
  </div>
}

function ViewContextBar({view,portfolio,selected}:{view:View;portfolio:Portfolio|null;selected:Project|null}){
  const meta=viewMeta[view]
  return <div className="view-context-bar">
    <div className="view-context-left">
      <span className="context-section">{meta.section}</span><ChevronRight size={11}/><strong>{meta.label}</strong>
      {view==='project'&&selected?<><ChevronRight size={11}/><span className="context-project">{selected.project_code}</span></>:null}
    </div>
    <div className="view-context-right">
      {meta.stage?<span className="context-stage"><i>{String(meta.stage).padStart(2,'0')}</i> {meta.stage===1?'OBSERVE':meta.stage===2?'LOCATE':meta.stage===3?'INVESTIGATE':'BRIEF'}</span>:null}
      <span className="context-hint">{meta.hint}</span>
      {portfolio?.report_period?<span className="context-period">{portfolio.report_period}</span>:null}
    </div>
  </div>
}

function Topbar({systemStatus,lastLoadedAt,portfolio,onToggle,onSync,refreshing,onSearch,onAI,onBrief,onDemo}:{systemStatus:SystemStatus;lastLoadedAt:number|null;portfolio:Portfolio|null;onToggle:()=>void;onSync:()=>void;refreshing:boolean;onSearch:()=>void;onAI:()=>void;onBrief:()=>void;onDemo:()=>void}){
  const statusLabel=systemStatus==='online'?'SYSTEM ONLINE':systemStatus==='offline'?'BACKEND OFFLINE':'CHECKING SYSTEM'
  const lastSync=lastLoadedAt?new Date(lastLoadedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—'
  return <header className="topbar-new">
    <div className="topbar-brand">
      <button className="menu-btn" onClick={onToggle} aria-label="Toggle navigation"><Menu size={19}/></button>
      <div className="brand-mark"><img src="/vantage-mark.png" alt=""/></div>
      <div><div className="brand-title">VANTAGE</div><div className="brand-caption">Disaster Intelligence Platform</div></div>
    </div>
    <div className="report-context"><span>Latest available reporting period</span><strong>{portfolio?.report_period||'—'}</strong><i/> <span>MoSPI / PAIMANA</span></div>
    <div className="topbar-actions">
      <button className="top-action" onClick={onSearch}><Search size={15}/><span>Search</span><kbd>Ctrl K</kbd></button>
      <button className="top-action" onClick={onSync} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/><span>{refreshing?'Checking…':'Check source'}</span></button>
      <button className="top-action" onClick={onAI}><Bot size={15}/><span>Analyst</span></button>
      <button className="top-action demo-top-action" onClick={onDemo}><Workflow size={15}/><span>Demo path</span><kbd>D</kbd></button>
      <button className="brief-btn" onClick={onBrief}><FileText size={15}/><span>National brief</span></button>
      <div className={`system-status-pill ${systemStatus}`} title={lastLoadedAt?`Latest data load ${lastSync}`:'Waiting for data'}><i/><span>{statusLabel}</span><small>{lastSync}</small></div>
    </div>
  </header>
}

function Sidebar({open,view,comparisonCount,latestReport,history,onNavigate,onAI}:{open:boolean;view:View;comparisonCount:number;latestReport?:string|null;history?:any;onNavigate:(v:View)=>void;onAI:()=>void}){
  const item=(v:View,label:string,icon:ReactNode,badge?:number)=><button title={label} aria-label={label} className={`side-item ${view===v?'active':''}`} onClick={()=>onNavigate(v)}><span>{icon}</span><b>{label}</b>{badge? <em>{badge}</em>:null}<ChevronRight size={14}/></button>
  return <aside className={`sidebar-new ${open?'':'collapsed'}`}>
    <div className="sidebar-scroll">
      <NavSection title="COMMAND CENTRE">
        {item('overview','National Overview',<Activity size={16}/>)}
        {item('map','Portfolio Map',<MapIcon size={16}/>)}
        {item('watchlist','Sentinel Watchlist',<Eye size={16}/>)}
      </NavSection>
      <NavSection title="INTELLIGENCE">
        {item('projects','All Projects',<Table2 size={16}/>)}
        {item('trajectory','Trajectory Analysis',<TrendingUp size={16}/>)}
        {item('stress','Commitment Stress',<Gauge size={16}/>)}
        {item('trends','Portfolio Trends',<BarChart3 size={16}/>)}
        {item('compare','Project Comparison',<GitCompareArrows size={16}/>,comparisonCount||undefined)}
      </NavSection>
      <NavSection title="EVIDENCE & TRUST">
        {item('trust','Data Trust Center',<ShieldCheck size={16}/>)}
        {item('sources','Source & Releases',<Database size={16}/>)}
      </NavSection>
      <NavSection title="ANALYTICAL TOOLS">
        <button title="Sentinel Analyst" aria-label="Sentinel Analyst" className="side-item" onClick={onAI}><span><Bot size={16}/></span><b>Sentinel Analyst</b><ChevronRight size={14}/></button>
        {item('brief','Generate Brief',<FileText size={16}/>)}
      </NavSection>
    </div>
    <div className="sidebar-footer"><div className="footer-emblem">अ</div><div><strong>MoSPI · PAIMANA</strong><span>{history?.earliest_period&&history?.latest_period?`History · ${history.earliest_period} → ${history.latest_period}`:`Latest snapshot · ${latestReport||'—'}`}</span></div></div>
  </aside>
}
function NavSection({title,children}:{title:string;children:ReactNode}){return <section className="nav-section"><div className="nav-section-title">{title}</div>{children}</section>}

function OverviewPage({portfolio,projects,queue,changes,integrity,source,mapStates,mapProjects,audit,mapNote,open,onMap,onWatchlist,onBrief}:{portfolio:Portfolio|null;projects:Project[];queue:Project[];changes:PortfolioChanges|null;integrity:any;source:any;mapStates:StateAggregate[];mapProjects:MapProjectPoint[];audit:EngineAudit|null;mapNote:string;open:(p:Project|string)=>void;onMap:()=>void;onWatchlist:()=>void;onBrief:()=>void}){
  const meanProgress=projects.length?projects.reduce((s,p)=>s+(p.physical_progress_pct||0),0)/projects.length:null
  const exposure=projects.reduce((s,p)=>s+(p.exposure_crore||0),0)
  const costEscalation=portfolio?.original_cost_crore&&portfolio.original_cost_crore>0?((portfolio.revised_cost_crore-portfolio.original_cost_crore)/portfolio.original_cost_crore)*100:null
  const spendRatio=portfolio?.revised_cost_crore&&portfolio.revised_cost_crore>0?(portfolio.expenditure_crore/portfolio.revised_cost_crore)*100:null
  const stateCount=new Set(projects.map(p=>p.state).filter(Boolean)).size
  const [watchTab,setWatchTab]=useState<'all'|'attention'|'stagnation'|'commitment'>('all')
  const watchItems=useMemo(()=>{
    let list=[...queue]
    if(watchTab==='attention')list=list.filter(p=>['critical','high','elevated'].includes(p.assessment_band||p.risk_band||'unknown'))
    if(watchTab==='stagnation')list=list.filter(p=>p.derived?.progress_delta_pct===0)
    if(watchTab==='commitment')list=list.filter(p=>(p.derived?.revision_count_to_date||0)>0)
    list.sort((a,b)=>(b.assessment_score||0)-(a.assessment_score||0))
    return list.slice(0,7)
  },[queue,watchTab])
  const openCount=Object.values((integrity?.open_flags||{}) as Record<string,number>).reduce((a,b)=>a+Number(b||0),0)
  const attentionCount=Number(portfolio?.attention_bands?.elevated_or_higher||0)
  const attentionShare=portfolio?.project_count?attentionCount/Number(portfolio.project_count)*100:null
  const movementCount=Number(changes?.summary?.progress_moved||0)
  const stagnantCount=Number(changes?.summary?.stagnant_progress||0)
  const commitmentRevisionCount=Number(changes?.summary?.completion_revised||0)
  const historyPeriods=Number(source?.history?.reporting_periods||0)
  const coveragePct=audit?.coverage_pct!=null?Number(audit.coverage_pct):null
  return <section className="page-shell overview-shell stitch-overview">
    <section className="overview-hero panel-new">
      <div>
        <div className="hero-meta-row">
          <span className="hero-badge">MoSPI SENTINEL</span>
          <span className="hero-meta">{portfolio?.report_period ? `PAI-${portfolio.report_period}-IND` : 'PAI-—-IND'}</span>
          <span className="hero-dot"/>
          <span className="hero-coverage"><ShieldCheck size={12}/> {audit?.coverage_pct!=null?`${fmtNum(audit.coverage_pct,1)}% ASSESSMENT COVERAGE`:'Assessment coverage unavailable'}</span>
        </div>
        <h1>NATIONAL PROJECT OVERVIEW</h1>
        <p>Evidence-backed monitoring of India's infrastructure project portfolio across {fmtInt(stateCount)} administrative groups.</p>
      </div>
      <div className="hero-actions">
        <button className="btn secondary" onClick={onMap}><MapIcon size={15}/>Portfolio map</button>
        <button className="btn secondary" onClick={onWatchlist}><Filter size={15}/>Open watchlist</button>
        <button className="btn primary" onClick={onBrief}><FileText size={15}/>Generate brief</button>
      </div>
    </section>

    <div className="demo-flow-ribbon" aria-label="Sentinel operating flow">
      <div className="flow-step active"><span>01</span><div><strong>DETECT</strong><small>Portfolio-wide signals</small></div><ArrowRight size={14}/></div>
      <div className="flow-step"><span>02</span><div><strong>DIAGNOSE</strong><small>Evidence + trajectory</small></div><ArrowRight size={14}/></div>
      <div className="flow-step"><span>03</span><div><strong>CONTEXTUALISE</strong><small>Peer-relative assessment</small></div><ArrowRight size={14}/></div>
      <div className="flow-step"><span>04</span><div><strong>BRIEF</strong><small>Decision-ready output</small></div></div>
    </div>

    <div className="national-status-bar">
      <div className="status-left">
        <span className="status-accent-dot"/>
        <strong>Latest available reporting period: {portfolio?.report_period||'—'}</strong>
        <span className="status-divider">|</span>
        <span>Official PAIMANA snapshot</span>
        <span className="status-divider">|</span>
        <span>{audit?.evaluated_count!=null?`${fmtInt(audit.evaluated_count)} / ${fmtInt(audit.total_latest_projects)} projects assessed`:'Assessment coverage unavailable'}</span>
      </div>
      <span className="status-method">Reference-class, non-probabilistic attention protocol</span>
    </div>
    <div className={`history-alert-strip ${source?.history?.state==='seed_recent'?'seed':''}`}>
      <div><Database size={13}/><strong>Historical coverage</strong><span>{source?.history?.earliest_period||'—'} → {source?.history?.latest_period||'—'}</span><em>{fmtInt(source?.history?.reporting_periods)} reporting periods · {fmtInt(source?.history?.snapshots)} snapshots</em></div>
      {source?.history?.state==='seed_recent' && <span className="history-alert-note">Official archive backfill is still required to extend beyond the bundled seed history.</span>}
      {source?.sync?.status && ['backfilling','inventorying'].includes(String(source.sync.status)) && <span className="history-alert-note">Historical archive backfill is running in the background.</span>}
    </div>

    <section className="executive-readout panel-new dark-command-surface" aria-label="Executive readout">
      <div className="executive-readout-head">
        <div><div className="eyebrow">EXECUTIVE READOUT</div><h2>What the current snapshot is showing</h2><p>Four observable signals give the judge a fast route from national context into project-level investigation.</p></div>
        <span className="readout-period-chip">{portfolio?.report_period||'—'} · DESCRIPTIVE</span>
      </div>
      <div className="executive-readout-grid">
        <button className="exec-readout-card attention" onClick={onWatchlist}>
          <div className="exec-card-top"><span>ATTENTION LAYER</span><ArrowUpRight size={13}/></div>
          <strong>{fmtInt(attentionCount)}</strong>
          <span>elevated-or-higher signals · {attentionShare==null?'—':`${attentionShare.toFixed(1)}% of latest portfolio`}</span>
          <i><b style={{width:`${clamp(attentionShare||0)}%`}}/></i>
        </button>
        <div className="exec-readout-card movement">
          <div className="exec-card-top"><span>MOVEMENT LAYER</span><Activity size={13}/></div>
          <strong>{fmtInt(movementCount)}</strong>
          <span>projects with reported progress movement · {fmtInt(stagnantCount)} with no change</span>
          <i><b style={{width:`${clamp(portfolio?.project_count?movementCount/Number(portfolio.project_count)*100:0)}%`}}/></i>
        </div>
        <div className="exec-readout-card commitment">
          <div className="exec-card-top"><span>COMMITMENT LAYER</span><CalendarClock size={13}/></div>
          <strong>{fmtInt(commitmentRevisionCount)}</strong>
          <span>completion-date revisions observed in the latest comparison</span>
          <i><b style={{width:`${clamp(portfolio?.project_count?commitmentRevisionCount/Number(portfolio.project_count)*100:0)}%`}}/></i>
        </div>
        <div className="exec-readout-card evidence">
          <div className="exec-card-top"><span>EVIDENCE LAYER</span><ShieldCheck size={13}/></div>
          <strong>{coveragePct==null?'—':`${coveragePct.toFixed(1)}%`}</strong>
          <span>assessment coverage · {fmtInt(historyPeriods)} reporting periods in the stored history</span>
          <i><b style={{width:`${clamp(coveragePct||0)}%`}}/></i>
        </div>
      </div>
      <div className="executive-readout-foot"><ShieldCheck size={13}/><span>Attention scores are reference-class analytical signals. The readout separates observed movement and commitments from derived assessment output.</span></div>
    </section>

    <section className="overview-metrics-grid">
      <section className="primary-kpi panel-new dark-command-surface">
        <div className="primary-kpi-head"><span>TOTAL MONITORED PROJECTS</span><span className="coverage-chip"><ShieldCheck size={11}/> {audit?.coverage_pct!=null?`${fmtNum(audit.coverage_pct,0)}% COVERAGE`:'—'}</span></div>
        <strong className="primary-number">{fmtInt(portfolio?.project_count)}</strong>
        <p>Pan-India projects in the latest reporting set</p>
        <div className="primary-foot"><span>Latest project register</span><b>{fmtInt(portfolio?.project_count)} records</b></div>
      </section>
      <section className="financial-baseline panel-new dark-command-surface">
        <div className="financial-head"><span>NATIONAL PORTFOLIO FINANCIAL &amp; EXECUTION BASELINE</span><span>Currency: INR Crore (₹ Cr)</span></div>
        <div className="financial-grid">
          <div className="readout"><span>REVISED COST</span><strong>{moneyCompact(portfolio?.revised_cost_crore)}</strong><small>{costEscalation==null?'Original baseline unavailable':`${costEscalation>=0?'+':''}${costEscalation.toFixed(1)}% vs original cost`}</small></div>
          <div className="readout"><span>EXPENDITURE</span><strong>{moneyCompact(portfolio?.expenditure_crore)}</strong><small>{spendRatio==null?'Execution ratio unavailable':`${spendRatio.toFixed(1)}% of revised cost`}</small></div>
          <div className="readout progress-readout"><span>PHYSICAL PROGRESS</span><strong>{pct(meanProgress,1)}</strong><i><b style={{width:`${clamp(meanProgress||0)}%`}}/></i></div>
          <div className="readout attention-readout"><span>ATTENTION SIGNALS</span><strong>{fmtInt(portfolio?.attention_bands?.elevated_or_higher)}</strong><small>{fmtInt(portfolio?.attention_bands?.critical)} critical · {fmtInt(portfolio?.attention_bands?.high)} high · {fmtInt(portfolio?.attention_bands?.elevated_or_higher)} elevated+</small></div>
          <div className="readout"><span>REMAINING EXPOSURE</span><strong>{moneyCompact(exposure)}</strong><small>Revised cost less reported expenditure</small></div>
        </div>
      </section>
    </section>

    <div className="overview-command-grid">
      <section className="map-hero-stitch panel-new">
        <div className="map-hero-head">
          <div><div className="eyebrow">PORTFOLIO MAP</div><h2>India infrastructure portfolio</h2><p>Clustered project geography with source-location transparency.</p></div>
          <button className="btn secondary compact" onClick={onMap}><MapIcon size={14}/>Full map</button>
        </div>
        <div className="mini-map-shell stitch-map-shell"><MapPage states={mapStates} projects={mapProjects} allProjects={projects} audit={audit} note={mapNote} onOpen={open} embedded/></div>
      </section>

      <section className="watchlist-stitch panel-new">
        <div className="watchlist-head-stitch">
          <div><div className="eyebrow">SENTINEL WATCHLIST</div><h2>Highest current attention signals</h2><p>Relative attention ranking from the complete latest portfolio.</p></div>
          <span className="watch-count-chip">{fmtInt(queue.length)} projects</span>
        </div>
        <div className="watch-tabs-stitch">
          {([['all','All'],['attention','Attention'],['stagnation','Stagnation'],['commitment','Commitment']] as const).map(([key,label])=><button key={key} className={watchTab===key?'active':''} onClick={()=>setWatchTab(key)}>{label}{key==='all'?` (${fmtInt(queue.length)})`:''}</button>)}
        </div>
        <div className="watch-mini-list-stitch">
          {watchItems.length?watchItems.map(p=><MiniWatchRow key={p.project_code} project={p} onOpen={open}/>):<div className="empty-state small-empty"><Eye size={18}/><h2>No projects match this watchlist</h2><p>Try another attention view.</p></div>}
        </div>
        <div className="watchlist-foot-stitch"><span>Highlighted <b>{watchItems.length?1:0}–{watchItems.length}</b> of <b>{fmtInt(queue.length)}</b></span><button className="inline-btn" onClick={onWatchlist}>Open full watchlist <ArrowRight size={13}/></button></div>
      </section>
    </div>

    <section className="pulse-panel panel-new">
      <div className="pulse-heading-row">
        <div className="pulse-heading"><span className="pulse-marker"/><div><strong>NATIONAL PULSE: WHAT CHANGED BETWEEN THE TWO LATEST REPORTING SNAPSHOTS</strong><small>{changes?.previous_period||'—'} → {changes?.current_period||portfolio?.report_period||'—'}</small></div></div>
        <span className="pulse-meta">{fmtInt(changes?.summary?.projects_current||projects.length)} comparative project records</span>
      </div>
      <div className="pulse-grid stitch-pulse-grid">
        <PulseCell label="Progress movement" value={fmtInt(changes?.summary.progress_moved)} meta={changes?.summary?`${fmtInt(changes.summary.positive_progress)} positive · ${fmtInt(changes.summary.negative_progress)} negative`:''} kind="blue" />
        <PulseCell label="No reported movement" value={fmtInt(changes?.summary.stagnant_progress)} meta="Where both periods were available" kind="neutral" />
        <PulseCell label="Commitment revisions" value={fmtInt(changes?.summary.completion_revised)} meta="Completion date changed" kind="saffron" />
        <PulseCell label="Reported cost changes" value={fmtInt(changes?.summary.cost_revised)} meta="Revised cost changed" kind="green" />
      </div>
    </section>

    <footer className="institutional-footer-stitch">
      <div className="institutional-icon"><ShieldCheck size={15}/></div>
      <div className="institutional-copy"><strong>PAIMANA Sentinel assessment semantics:</strong> reference-class attention score derived from observed project history and peer cohorts. It is not a validated probability.</div>
      <div className="institutional-source">Official provenance: MoSPI / PAIMANA</div>
    </footer>
    {openCount>0&&<div className="trust-footnote">{fmtInt(openCount)} open data-quality observations are tracked separately from project assessment.</div>}
  </section>
}
function PageHeader({eyebrow,title,subtitle,actions}:{eyebrow:string;title:string;subtitle:string;actions?:ReactNode}){return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{actions&&<div className="page-actions">{actions}</div>}</div>}
function Kpi({label,value,icon,note,accent}:{label:string;value:string;icon:ReactNode;note:string;accent?:string}){return <div className={`kpi-card ${accent||''}`}><div className="kpi-icon">{icon}</div><div className="kpi-body"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>}
function PulseCell({label,value,meta,kind}:{label:string;value:string;meta:string;kind:string}){return <div className={`pulse-cell ${kind}`}><div><span>{label}</span><em>{kind==='saffron'?'Revision':kind==='green'?'Cost':kind==='blue'?'Movement':'Snapshot'}</em></div><strong>{value}</strong><small>{meta}</small><div className="cell-bar"><i/></div></div>}
function WorkflowStep({n,label,text}:{n:string;label:string;text:string}){return <div className="workflow-step"><b>{n}</b><div><strong>{label}</strong><span>{text}</span></div></div>}
function MiniWatchRow({project,onOpen}:{project:Project;onOpen:(p:Project|string)=>void}){const s=score(project.assessment_score);const b=project.assessment_band||band(project.assessment_score);return <button className="mini-watch-row" onClick={()=>onOpen(project)}><span className={`status-bar ${b}`}/><div className="mw-main"><div className="mw-id">{project.project_code}</div><strong>{project.name}</strong><small>{project.state||'—'} · {project.sector||'—'}</small></div><div className="mw-score"><b>{s??'—'}</b><span>{bandLabel(b)}</span></div><ChevronRight size={15}/></button>}

function MapPage({states,projects,allProjects,audit,note,onOpen,onBack,embedded=false}:{states:StateAggregate[];projects:MapProjectPoint[];allProjects:Project[];audit:EngineAudit|null;note:string;onOpen:(p:Project|string)=>void;onBack?:()=>void;embedded?:boolean}){
  type DistrictContext={name:string;state:string;lat:number;lng:number}
  type ProjectLocation={lat:number;lng:number;kind:'exact'|'district'|'state';label:string;groupKey:string;groupLabel:string}
  const ref=useRef<HTMLDivElement|null>(null)
  const mapRef=useRef<L.Map|null>(null)
  const tileRef=useRef<L.TileLayer|null>(null)
  const roadOverlayRef=useRef<L.TileLayer|null>(null)
  const districtLayerRef=useRef<L.GeoJSON|null>(null)
  const markersRef=useRef<L.LayerGroup|null>(null)
  const fallbackRef=useRef<L.LayerGroup|null>(null)
  const [base,setBase]=useState<Base>('roads')
  const [metric,setMetric]=useState<'projects'|'progress'|'revised'|'expenditure'>('projects')
  const [selectedState,setSelectedState]=useState('all')
  const [search,setSearch]=useState('')
  const [attention,setAttention]=useState(false)
  const [geoStatus,setGeoStatus]=useState<'loading'|'ready'|'fallback'>('loading')
  const [districtIndex,setDistrictIndex]=useState<DistrictContext[]>([])
  const [selectedMarker,setSelectedMarker]=useState<MapProjectPoint|null>(null)
  const [mapError,setMapError]=useState<string|null>(null)

  const stateAggregate=useMemo(()=>{const m:Record<string,StateAggregate>={};states.forEach(s=>m[normalize(s.state)]=s);return m},[states])
  const visible=useMemo(()=>{
    const needle=search.trim().toLowerCase()
    return allProjects.filter(p=>{
      if(selectedState!=='all' && p.state!==selectedState)return false
      if(attention && !['critical','high','elevated'].includes(p.assessment_band||p.risk_band||'unknown'))return false
      if(!needle)return true
      return [p.project_code,p.name,p.state,p.sector,p.ministry,p.agency].some(v=>String(v||'').toLowerCase().includes(needle))
    })
  },[allProjects,selectedState,attention,search])

  const mapProjectByCode=useMemo(()=>new Map(projects.map(p=>[p.project_code,p])),[projects])
  const districtsByState=useMemo(()=>{
    const out:Record<string,DistrictContext[]>={}
    districtIndex.forEach(d=>{(out[normalize(d.state)]??=[]).push(d)})
    return out
  },[districtIndex])

  const projectLocation=useCallback((p:Project):ProjectLocation|null=>{
    if(p.location_status==='exact_gps' && p.latitude!=null && p.longitude!=null){
      const groupKey=`exact:${p.latitude.toFixed(3)}:${p.longitude.toFixed(3)}`
      return {lat:p.latitude,lng:p.longitude,kind:'exact',label:'Exact source GPS',groupKey,groupLabel:'Source location'}
    }
    const state=p.state||''
    const normalizedName=normalize(String(p.name||''))
    let best:DistrictContext|null=null; let bestLen=0
    for(const d of districtsByState[normalize(state)]||[]){
      const compact=normalize(d.name)
      if(compact.length<5)continue
      if(normalizedName.includes(compact) && compact.length>bestLen){best=d;bestLen=compact.length}
    }
    if(best){
      const groupKey=`district:${normalize(best.state)}:${normalize(best.name)}`
      return {lat:best.lat,lng:best.lng,kind:'district',label:`District administrative context: ${best.name}`,groupKey,groupLabel:best.name}
    }
    const center=stateCenters[state]
    if(center){
      const groupKey=`state:${normalize(state)}`
      return {lat:center[0],lng:center[1],kind:'state',label:'State administrative context — not exact project geography',groupKey,groupLabel:state}
    }
    return null
  },[districtsByState])
  const mappedVisibleCount=useMemo(()=>visible.reduce((n,p)=>n+(projectLocation(p)?1:0),0),[visible,projectLocation])

  useEffect(()=>{
    if(!ref.current || mapRef.current)return
    try{
      const m=L.map(ref.current,{zoomControl:false,attributionControl:true,preferCanvas:true,scrollWheelZoom:true,zoomSnap:0.5,zoomDelta:0.5,minZoom:4,maxZoom:18}).setView([22.7,79.2],5)
      tileRef.current=L.tileLayer(bases.roads.tiles,{maxZoom:18,attribution:bases.roads.attr}).addTo(m)
      L.control.zoom({position:'bottomright'}).addTo(m)
      mapRef.current=m
      setMapError(null)
      setTimeout(()=>m.invalidateSize({pan:false}),0)
      const resizeObserver=new ResizeObserver(()=>m.invalidateSize({pan:false}))
      resizeObserver.observe(ref.current)
      return()=>{resizeObserver.disconnect();m.remove();mapRef.current=null}
    }catch(err){
      setMapError(err instanceof Error?err.message:'Map failed to initialize.')
      mapRef.current=null
    }
  },[])

  useEffect(()=>{
    if(!mapRef.current)return
    tileRef.current?.remove()
    roadOverlayRef.current?.remove()
    tileRef.current=L.tileLayer(bases[base].tiles,{maxZoom:18,attribution:bases[base].attr}).addTo(mapRef.current)
    if(base==='hybrid'){
      roadOverlayRef.current=L.tileLayer(bases.roads.tiles,{maxZoom:18,opacity:.68,attribution:bases.roads.attr}).addTo(mapRef.current)
    }
    districtLayerRef.current?.bringToFront()
  },[base])

  // District geometry is also loaded for the embedded dashboard map so project
  // records can be grouped by district before the user opens the full map.
  useEffect(()=>{
    if(!mapRef.current)return
    let cancelled=false
    const slugs=['andaman-and-nicobar-islands','andhra-pradesh','arunachal-pradesh','assam','bihar','chandigarh','chhattisgarh','delhi','dnh-and-dd','goa','gujarat','haryana','himachal-pradesh','jammu-and-kashmir','jharkhand','karnataka','kerala','ladakh','lakshadweep','madhya-pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','puducherry','punjab','rajasthan','sikkim','tamil-nadu','telangana','tripura','uttar-pradesh','uttarakhand','west-bengal']
    setGeoStatus('loading')
    Promise.all(slugs.map(slug=>fetch(`https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@2884453/geojson/states/${slug}.geojson`).then(r=>r.ok?r.json():null).catch(()=>null))).then(features=>{
      if(cancelled||!mapRef.current)return
      const valid=features.filter(Boolean)
      if(!valid.length){setGeoStatus('fallback');return}
      const index:DistrictContext[]=[]
      const slugState=(slug:string)=>slug.split('-').map(s=>s?`${s[0].toUpperCase()}${s.slice(1)}`:'').join(' ')
      valid.forEach((geo:any,i)=>{(geo.features||[]).forEach((f:any)=>{
        const pr=f.properties||{}
        const district=pr.district||pr.DISTRICT||pr.Dist_Name||pr.NAME_2||pr.NAME_3||pr.name||pr.NAME
        const state=pr.state||pr.STATE||pr.ST_NM||slugState(slugs[i])
        if(!district)return
        try{
          const center=L.geoJSON(f).getBounds().getCenter()
          index.push({name:String(district),state:String(state),lat:center.lat,lng:center.lng})
        }catch{}
      })})
      setDistrictIndex(index)
      if(!embedded){
        districtLayerRef.current?.remove()
        districtLayerRef.current=L.geoJSON({type:'FeatureCollection',features:valid.flatMap((g:any)=>g.features||[])},{
          style:{color:'#8fa0b4',weight:.65,fillColor:'#1565C0',fillOpacity:.055,opacity:.75},
          onEachFeature:(f:any,l:any)=>{
            const pr=f.properties||{}
            const n=pr.district||pr.DISTRICT||pr.name||pr.NAME
            const st=pr.state||pr.STATE||pr.ST_NM
            l.bindTooltip(`<strong>${n||'Administrative area'}</strong>${st?`<br/>${st}`:''}`,{sticky:true,direction:'top'})
            l.on('click',()=>{
              const match=states.find(x=>normalize(x.state)===normalize(String(st||'')))
              if(match)setSelectedState(match.state)
            })
          }
        }).addTo(mapRef.current)
      }
      setGeoStatus('ready')
      setTimeout(()=>mapRef.current?.invalidateSize(),0)
    }).catch(()=>setGeoStatus('fallback'))
    return()=>{cancelled=true}
  },[embedded,states])

  useEffect(()=>{
    if(embedded||!districtLayerRef.current)return
    const maxValue=Math.max(1,...states.map(s=>metric==='projects'?s.count:metric==='progress'?(s.avg_progress||0):metric==='revised'?s.revised_cost_crore:s.expenditure_crore))
    const styleFeature=(f:any)=>{
      const pr=f?.properties||{}
      const stateName=String(pr.state||pr.STATE||pr.ST_NM||'')
      const agg=stateAggregate[normalize(stateName)]
      const value=agg?(metric==='projects'?agg.count:metric==='progress'?(agg.avg_progress||0):metric==='revised'?agg.revised_cost_crore:agg.expenditure_crore):0
      const ratio=clamp(Number(value||0)/maxValue,0,1)
      return {color:'#8fa0b4',weight:.65,fillColor:'#1565C0',fillOpacity:agg?0.035+0.20*ratio:0.025,opacity:.78}
    }
    districtLayerRef.current.setStyle(styleFeature as any)
  },[embedded,metric,stateAggregate,states])

  useEffect(()=>{
    const map=mapRef.current
    if(!map)return
    if(!markersRef.current)markersRef.current=L.layerGroup()
    if(!fallbackRef.current)fallbackRef.current=L.layerGroup()
    const markerLayer=markersRef.current
    const fallbackLayer=fallbackRef.current
    markerLayer.clearLayers();fallbackLayer.clearLayers();setSelectedMarker(null)

    const located=visible.map(p=>{const loc=projectLocation(p);return loc?{project:p,loc}:null}).filter(Boolean) as Array<{project:Project;loc:ProjectLocation}>
    const fallbackCounts:Record<string,{state:string;count:number;lat:number;lng:number}>={}
    visible.forEach(p=>{
      if(p.location_status==='unavailable'){
        const st=p.state||'Unknown'; const c=stateCenters[st]
        if(!c)return
        fallbackCounts[st]??={state:st,count:0,lat:c[0],lng:c[1]}; fallbackCounts[st].count++
      }
    })

    const bandColor=(p:Project)=>({critical:'#C62828',high:'#B64A1C',elevated:'#D97706',watch:'#1565C0',low:'#2E7D32'}[p.assessment_band||p.risk_band||'watch']||'#1565C0')
    const makeClusterIcon=(count:number,label:string)=>L.divIcon({className:'sentinel-cluster-icon',html:`<div class="sentinel-cluster-bubble"><strong>${fmtInt(count)}</strong><span>${label}</span></div>`,iconSize:[82,50],iconAnchor:[41,25]})
    const makePoint=(project:Project,loc:ProjectLocation,offsetIndex:number,totalAtLocation:number)=>{
      let lat=loc.lat,lng=loc.lng
      // When source GPS is unavailable, multiple records may share the same
      // administrative context. The tiny deterministic fan only separates
      // records visually; the tooltip makes clear it is not project geography.
      if(totalAtLocation>1 && loc.kind!=='exact'){
        const seed=[...String(project.project_code||'0')].reduce((a,ch)=>(a*31+ch.charCodeAt(0))%360,7)
        const angle=(seed+offsetIndex*(360/totalAtLocation))*Math.PI/180
        const radius=loc.kind==='district'?0.035:0.055
        lat+=Math.sin(angle)*radius
        lng+=(Math.cos(angle)*radius)/Math.max(0.3,Math.cos(lat*Math.PI/180))
      }
      const marker=L.circleMarker([lat,lng],{radius:loc.kind==='exact'?5:4.7,weight:2,color:'#fff',fillColor:bandColor(project),fillOpacity:.95})
      const contextNote=loc.kind==='exact'?'Exact source GPS':loc.kind==='district'?'District administrative context · visual offset only':'State administrative context · visual offset only'
      marker.bindTooltip(`<strong>${project.name||'Unnamed project'}</strong><br/>${project.project_code}<br/><span>${contextNote}</span>`,{direction:'top',offset:[0,-5]})
      marker.on('click',()=>{
        setSelectedMarker(mapProjectByCode.get(project.project_code)||({project_code:project.project_code,name:project.name,state:project.state} as MapProjectPoint))
        map.setView([lat,lng],Math.max(map.getZoom(),9),{animate:true})
      })
      return marker
    }

    const render=()=>{
      markerLayer.clearLayers()
      const zoom=map.getZoom()
      const byGroup=new Map<string,Array<(typeof located)[number]>>()
      for(const item of located){const arr=byGroup.get(item.loc.groupKey)||[];arr.push(item);byGroup.set(item.loc.groupKey,arr)}
      const locationMultiplicity=new Map<string,Array<(typeof located)[number]>>()
      for(const item of located){const key=`${item.loc.lat.toFixed(4)}:${item.loc.lng.toFixed(4)}`;const arr=locationMultiplicity.get(key)||[];arr.push(item);locationMultiplicity.set(key,arr)}

      if(zoom<=4){
        for(const [groupKey,items] of byGroup){
          const {loc}=items[0]
          const shouldCluster=items.length>=2 || loc.kind==='state'
          if(!shouldCluster){markerLayer.addLayer(makePoint(items[0].project,loc,0,1));continue}
          const lat=items.reduce((a,x)=>a+x.loc.lat,0)/items.length
          const lng=items.reduce((a,x)=>a+x.loc.lng,0)/items.length
          const label=loc.kind==='district'?'DISTRICT GROUP':'STATE CONTEXT'
          const marker=L.marker([lat,lng],{icon:makeClusterIcon(items.length,label)})
          marker.bindTooltip(`<strong>${fmtInt(items.length)} projects</strong><br/>${loc.groupLabel}<br/>Zoom in to inspect project records.`,{direction:'top'})
          marker.on('click',()=>{
            if(items.length===1){onOpen(items[0].project);return}
            const bounds=L.latLngBounds(items.map(x=>[x.loc.lat,x.loc.lng] as [number,number]))
            if(bounds.isValid() && bounds.getSouthWest().lat!==bounds.getNorthEast().lat)map.fitBounds(bounds.pad(.12),{maxZoom:8,animate:true})
            else map.setView([lat,lng],Math.min(8,map.getZoom()+2),{animate:true})
          })
          markerLayer.addLayer(marker)
        }
      }else if(zoom<=6){
        for(const items of byGroup.values()){
          if(items.length>=6){
            const {loc}=items[0]
            const lat=items.reduce((a,x)=>a+x.loc.lat,0)/items.length
            const lng=items.reduce((a,x)=>a+x.loc.lng,0)/items.length
            const marker=L.marker([lat,lng],{icon:makeClusterIcon(items.length,loc.kind==='district'?'DISTRICT GROUP':'STATE CONTEXT')})
            marker.bindTooltip(`<strong>${fmtInt(items.length)} project records</strong><br/>${loc.groupLabel}<br/>Zoom further to inspect individually.`,{direction:'top'})
            marker.on('click',()=>map.setView([lat,lng],Math.min(9,map.getZoom()+2),{animate:true}))
            markerLayer.addLayer(marker)
          }else{
            items.forEach(item=>{
              const siblings=locationMultiplicity.get(`${item.loc.lat.toFixed(4)}:${item.loc.lng.toFixed(4)}`)||[]
              markerLayer.addLayer(makePoint(item.project,item.loc,siblings.findIndex(x=>x.project.project_code===item.project.project_code),siblings.length))
            })
          }
        }
      }else{
        for(const item of located){
          const siblings=locationMultiplicity.get(`${item.loc.lat.toFixed(4)}:${item.loc.lng.toFixed(4)}`)||[]
          const index=siblings.findIndex(x=>x.project.project_code===item.project.project_code)
          markerLayer.addLayer(makePoint(item.project,item.loc,index,siblings.length))
        }
      }

      fallbackLayer.clearLayers()
      Object.values(fallbackCounts).forEach(x=>{
        const marker=L.marker([x.lat,x.lng],{icon:makeClusterIcon(x.count,'LOCATION UNAVAILABLE')})
        marker.bindTooltip(`<strong>${x.state}</strong><br/>${fmtInt(x.count)} projects have no usable location in the current snapshot.`,{direction:'top'})
        marker.on('click',()=>{if(map.getZoom()<7)map.setView([x.lat,x.lng],7,{animate:true})})
        fallbackLayer.addLayer(marker)
      })
    }

    render(); map.on('zoomend moveend',render); markerLayer.addTo(map); fallbackLayer.addTo(map)
    return()=>{map.off('zoomend moveend',render);markerLayer.clearLayers();fallbackLayer.clearLayers()}
  },[visible,projectLocation,mapProjectByCode,onOpen])

  const matchingProject=selectedMarker?allProjects.find(p=>p.project_code===selectedMarker.project_code):null
  const selectedAgg=selectedState==='all'?null:states.find(s=>s.state===selectedState)
  const shellClass=embedded?'embedded-map':'full-map'
  return <div className={shellClass}>
    <div ref={ref} className="map-canvas-new"/>
    {mapError&&<div className="map-error-state"><AlertTriangle size={20}/><strong>Portfolio map unavailable</strong><span>{mapError}</span></div>}
    {!embedded&&onBack&&<button className="map-back" onClick={onBack}><ArrowLeft size={15}/>Back to overview</button>}
    <div className="map-head-float"><div><div className="eyebrow">PROJECT GEOGRAPHY</div><strong>{selectedState==='all'?'National portfolio':selectedState}</strong></div><span>{fmtInt(visible.length)} records · {fmtInt(mappedVisibleCount)} mapped</span></div>
    <div className="map-control-float">
      <div className="map-search"><Search size={14}/><input aria-label="Search project, state or ministry on map" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search project, state, ministry…"/></div>
      <div className="map-control-row"><select aria-label="Map metric" value={metric} onChange={e=>setMetric(e.target.value as any)}><option value="projects">Projects</option><option value="progress">Physical progress</option><option value="revised">Revised cost</option><option value="expenditure">Expenditure</option></select><button aria-pressed={attention} className={`map-filter-btn ${attention?'active-filter':''}`} onClick={()=>setAttention(v=>!v)}><Filter size={14}/>Attention {attention?'on':''}</button></div>
      <div className="basemap-row">{(Object.keys(bases) as Base[]).map(b=><button key={b} className={base===b?'active':''} onClick={()=>setBase(b)}><Layers3 size={12}/>{bases[b].label}</button>)}</div>
      <div className="map-semantics-note">Zoom out to see district groups where the source text supports district context. Zoom to 7+ to inspect individual project records. Administrative-context offsets are visual separators, not exact project geography.</div>
    </div>
    {selectedAgg&&<button className="state-focus-chip" onClick={()=>setSelectedState('all')}><span>{selectedAgg.state}</span><b>{fmtInt(selectedAgg.count)} projects</b><X size={13}/></button>}
    {matchingProject&&selectedMarker&&<div className="map-project-pop"><button className="close-mini" onClick={()=>setSelectedMarker(null)}><X size={14}/></button><div className="eyebrow">SELECTED PROJECT</div><strong>{matchingProject.name}</strong><span>{matchingProject.project_code} · {matchingProject.state||'—'} · {matchingProject.sector||'—'}</span><div className="map-project-badge-row"><span className={`map-band-badge ${matchingProject.assessment_band||band(matchingProject.assessment_score)}`}>{bandLabel(matchingProject.assessment_band||band(matchingProject.assessment_score))}</span><span className="map-location-badge">{matchingProject.location_status==='exact_gps'?'Source GPS':matchingProject.location_status==='unavailable'?'Location unavailable':'Administrative context'}</span></div><div className="map-project-metrics"><div><small>Progress</small><b>{pct(matchingProject.physical_progress_pct)}</b></div><div><small>Attention</small><b>{score(matchingProject.assessment_score)??'—'}/100</b></div><div><small>Revised cost</small><b>{moneyCompact(matchingProject.revised_cost_crore)}</b></div></div><div className="map-project-actions"><button onClick={()=>onOpen(matchingProject)}>Open project <ArrowRight size={13}/></button></div></div>}
    <div className="map-legend-float"><div><i className="legend-dot exact"/>Exact GPS</div><div><i className="legend-dot district"/>District context</div><div><i className="legend-dot state"/>State context</div><div><i className="legend-dot unknown"/>Unavailable</div></div>
    {!embedded&&<div className="map-bottom-float"><span>{geoStatus==='ready'?'District reference layer loaded':'District reference unavailable'}</span><span>{fmtInt(audit?.evaluated_count||allProjects.length)} assessed</span><span className="push">{note}</span></div>}
  </div>
}

function WatchlistPage({queue,projects,integrity,onOpen,onCompare}:{queue:Project[];projects:Project[];integrity:{samples:any[]};onOpen:(p:Project|string)=>void;onCompare:(p:Project)=>void}){
  const [tab,setTab]=useState<QueueTab>('all'); const [q,setQ]=useState(''); const [state,setState]=useState('all'); const [sector,setSector]=useState('all'); const [sort,setSort]=useState<'assessment'|'exposure'|'progress'|'name'>('assessment'); const [page,setPage]=useState(1); const size=20
  const states=useMemo(()=>Array.from(new Set(projects.map(p=>p.state).filter(Boolean) as string[])).sort(),[projects]); const sectors=useMemo(()=>Array.from(new Set(projects.map(p=>p.sector).filter(Boolean) as string[])).sort(),[projects]); const integrityCodes=useMemo(()=>new Set((integrity?.samples||[]).map((x:any)=>String(x.project_code))),[integrity])
  const filtered=useMemo(()=>{
    let list=[...queue]
    const needle=q.trim().toLowerCase()
    list=list.filter(p=>{
      if(needle && ![p.project_code,p.name,p.state,p.sector,p.ministry].some(v=>String(v||'').toLowerCase().includes(needle)))return false
      if(state!=='all'&&p.state!==state)return false; if(sector!=='all'&&p.sector!==sector)return false
      if(tab==='attention'&&!['critical','high','elevated'].includes(p.assessment_band||p.risk_band||'unknown'))return false
      if(tab==='stagnation'&&!(p.derived?.progress_delta_pct===0))return false
      if(tab==='commitment'&&!(p.derived?.revision_count_to_date&&p.derived.revision_count_to_date>0))return false
      if(tab==='trust'&&p.location_status!=='unavailable'&&!integrityCodes.has(p.project_code))return false
      if(tab==='recovery'&&!(p.derived?.required_monthly_progress_pct!=null))return false
      return true
    })
    list.sort((a,b)=>sort==='assessment'?((b.assessment_score||0)-(a.assessment_score||0)):sort==='exposure'?((b.exposure_crore||0)-(a.exposure_crore||0)):sort==='progress'?((a.physical_progress_pct||0)-(b.physical_progress_pct||0)):a.name.localeCompare(b.name))
    return list
  },[queue,q,state,sector,tab,sort,integrityCodes])
  useEffect(()=>setPage(1),[q,state,sector,tab,sort])
  const items=filtered.slice((page-1)*size,page*size); const pages=Math.max(1,Math.ceil(filtered.length/size))
  return <section className="page-shell"><PageHeader eyebrow="MONITORING" title="Sentinel Watchlist" subtitle="The complete latest project set, organized around observable attention signals." actions={<button className="btn secondary" onClick={client.exportCsv}><Download size={15}/>Export CSV</button>} />
    <div className="watch-controls panel-new"><div className="watch-tabs">{(['all','attention','stagnation','commitment','trust','recovery'] as QueueTab[]).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='all'?'All':t[0].toUpperCase()+t.slice(1)}</button>)}</div><div className="filter-row-wide"><div className="search-box"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${fmtInt(projects.length)} projects…`}/></div><select value={state} onChange={e=>setState(e.target.value)}><option value="all">All states</option>{states.map(x=><option key={x}>{x}</option>)}</select><select value={sector} onChange={e=>setSector(e.target.value)}><option value="all">All sectors</option>{sectors.map(x=><option key={x}>{x}</option>)}</select><select value={sort} onChange={e=>setSort(e.target.value as any)}><option value="assessment">Assessment</option><option value="exposure">Exposure</option><option value="progress">Lowest progress</option><option value="name">Project name</option></select></div></div>
    <div className="table-panel panel-new"><div className="table-topline"><strong>{fmtInt(filtered.length)} matching projects</strong><span>Showing {items.length?`${(page-1)*size+1}–${Math.min(page*size,filtered.length)}`:'0'} of {fmtInt(filtered.length)}</span></div><div className="table-wrap"><table className="data-table-new"><thead><tr><th>Project</th><th>State</th><th>Sector</th><th>Progress</th><th>Revised cost</th><th>Assessment</th><th>Data trust</th><th>Actions</th></tr></thead><tbody>{items.map(p=><ProjectRow key={p.project_code} p={p} onOpen={onOpen} onCompare={onCompare} trustObserved={integrityCodes.has(p.project_code)} />)}</tbody></table></div><Pagination page={page} pages={pages} setPage={setPage}/></div>
  </section>
}
function ProjectRow({p,onOpen,onCompare,trustObserved}:{p:Project;onOpen:(p:Project|string)=>void;onCompare:(p:Project)=>void;trustObserved?:boolean}){const s=score(p.assessment_score);const b=p.assessment_band||band(p.assessment_score);return <tr><td><button className="project-cell" onClick={()=>onOpen(p)}><span>{p.project_code}</span><strong>{p.name}</strong><small>{p.ministry||'Ministry not reported'}</small></button></td><td>{p.state||'—'}</td><td>{p.sector||'—'}</td><td><div className="table-progress"><b>{pct(p.physical_progress_pct)}</b><i><span style={{width:`${clamp(p.physical_progress_pct||0)}%`}}/></i></div></td><td>{moneyCompact(p.revised_cost_crore)}</td><td><StatusBadge band={b} score={s}/></td><td><span className={`trust-chip ${p.location_status==='unavailable'?'muted':''}`}>{trustObserved?'QA observation':p.location_status==='exact_gps'?'Source GPS':p.location_status==='unavailable'?'Unavailable':'Admin context'}</span></td><td><div className="row-actions"><button onClick={()=>onCompare(p)} title="Compare"><GitCompareArrows size={14}/></button><button onClick={()=>onOpen(p)} title="Open"><ChevronRight size={14}/></button></div></td></tr>}
function StatusBadge({band,score}:{band:RiskBand;score:number|null}){return <span className={`status-badge ${band}`}><i/>{score==null?'Unavailable':`${score}/100 · ${bandLabel(band)}`}</span>}
function Pagination({page,pages,setPage}:{page:number;pages:number;setPage:(n:number)=>void}){return <div className="pagination"><span>Page {page} of {pages}</span><div><button disabled={page<=1} onClick={()=>setPage(page-1)}><ArrowLeft size={14}/>Previous</button><button disabled={page>=pages} onClick={()=>setPage(page+1)}>Next<ArrowRight size={14}/></button></div></div>}

function ProjectsPage({projects,states,onOpen,onCompare,onExport}:{projects:Project[];states:string[];onOpen:(p:Project|string)=>void;onCompare:(p:Project)=>void;onExport:()=>void}){
  const [q,setQ]=useState('');const [state,setState]=useState('all');const [status,setStatus]=useState('all');const [page,setPage]=useState(1);const size=25
  const filtered=useMemo(()=>projects.filter(p=>{const txt=[p.project_code,p.name,p.state,p.sector,p.ministry,p.agency].join(' ').toLowerCase();const completed=(p.physical_progress_pct||0)>=100?'Completed':'Under Implementation';return (!q||txt.includes(q.toLowerCase()))&&(state==='all'||p.state===state)&&(status==='all'||completed===status)}),[projects,q,state,status])
  useEffect(()=>setPage(1),[q,state,status]); const items=filtered.slice((page-1)*size,page*size); const pages=Math.max(1,Math.ceil(filtered.length/size))
  const summary=useMemo(()=>{const groups:Record<string,{count:number;progress:number;cost:number;exp:number}>={};projects.forEach(p=>{const k=p.state||'Not reported';const g=groups[k]||(groups[k]={count:0,progress:0,cost:0,exp:0});g.count++;g.progress+=p.physical_progress_pct||0;g.cost+=p.revised_cost_crore||0;g.exp+=p.expenditure_crore||0});return Object.entries(groups).map(([name,x])=>({name,...x,avg:x.count?x.progress/x.count:0})).sort((a,b)=>b.count-a.count).slice(0,8)},[projects])
  return <section className="page-shell"><PageHeader eyebrow="PORTFOLIO" title="All Projects" subtitle={`Browse the latest ${fmtInt(projects.length)}-project register with institutional filters and compact data-table ergonomics.`} actions={<button className="btn primary" onClick={onExport}><Download size={15}/>Export CSV</button>} />
    <div className="portfolio-summary-cards">{summary.map(s=><div className="state-summary" key={s.name}><span>{s.name}</span><strong>{fmtInt(s.count)}</strong><small>{pct(s.avg)} avg progress</small><i><b style={{width:`${clamp(s.avg)}%`}}/></i></div>)}</div>
    <div className="panel-new"><div className="filter-row-wide all-project-filters"><div className="search-box"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Project ID, name, ministry, state, sector…"/></div><select value={state} onChange={e=>setState(e.target.value)}><option value="all">All states</option>{states.map(x=><option key={x}>{x}</option>)}</select><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All status</option><option>Under Implementation</option><option>Completed</option></select></div></div>
    <div className="table-panel panel-new"><div className="table-topline"><strong>{fmtInt(filtered.length)} project records</strong><span>Latest available project set</span></div><div className="table-wrap"><table className="data-table-new"><thead><tr><th>Project</th><th>State</th><th>Sector</th><th>Progress</th><th>Revised cost</th><th>Expenditure</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map(p=><tr key={p.project_code}><td><button className="project-cell" onClick={()=>onOpen(p)}><span>{p.project_code}</span><strong>{p.name}</strong><small>{p.ministry||'Ministry not reported'}</small></button></td><td>{p.state||'—'}</td><td>{p.sector||'—'}</td><td><div className="table-progress"><b>{pct(p.physical_progress_pct)}</b><i><span style={{width:`${clamp(p.physical_progress_pct||0)}%`}}/></i></div></td><td>{moneyCompact(p.revised_cost_crore)}</td><td>{moneyCompact(p.expenditure_crore)}</td><td><span className="plain-status">{(p.physical_progress_pct||0)>=100?'Completed':'Under implementation'}</span></td><td><div className="row-actions"><button onClick={()=>onCompare(p)}><GitCompareArrows size={14}/></button><button onClick={()=>onOpen(p)}><ChevronRight size={14}/></button></div></td></tr>)}</tbody></table></div><Pagination page={page} pages={pages} setPage={setPage}/></div>
  </section>
}

function TrajectoryLibraryPage({projects,onOpen}:{projects:Project[];onOpen:(p:Project|string)=>void}){
  const [q,setQ]=useState('')
  const candidates=useMemo(()=>projects.filter(p=>[p.project_code,p.name,p.state,p.sector].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0,100),[projects,q])
  return <section className="page-shell"><PageHeader eyebrow="INTELLIGENCE" title="Trajectory Analysis" subtitle="Explore projects using the descriptive trajectory foundation built from the available reporting history." actions={<div className="search-box compact"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Find a project…"/></div>} /><div className="library-grid">{candidates.slice(0,24).map(p=><TrajectoryCard key={p.project_code} p={p} onOpen={onOpen}/>)}</div></section>
}
function TrajectoryCard({p,onOpen}:{p:Project;onOpen:(p:Project|string)=>void}){const delta=p.derived?.progress_delta_pct; return <button className="trajectory-card panel-new" onClick={()=>onOpen(p)}><div className="tc-top"><span>{p.project_code}</span><span className={`delta-chip ${delta==null?'neutral':delta>0?'positive':delta<0?'negative':'neutral'}`}>{delta==null?'No comparison':`${delta>0?'+':''}${delta.toFixed(1)} pp latest`}</span></div><strong>{p.name}</strong><small>{p.state||'—'} · {p.sector||'—'}</small><div className="tc-metrics"><div><span>Progress</span><b>{pct(p.physical_progress_pct)}</b></div><div><span>Required rate</span><b>{p.derived?.required_monthly_progress_pct!=null?`${p.derived.required_monthly_progress_pct.toFixed(1)} pp/mo`:'—'}</b></div><div><span>Revisions</span><b>{fmtInt(p.derived?.revision_count_to_date)}</b></div></div><div className="tc-bar"><span style={{width:`${clamp(p.physical_progress_pct||0)}%`}}/></div></button>}

function StressLibraryPage({projects,onOpen}:{projects:Project[];onOpen:(p:Project|string)=>void}){const items=useMemo(()=>projects.filter(p=>p.derived?.required_monthly_progress_pct!=null).sort((a,b)=>(b.derived?.required_monthly_progress_pct||0)-(a.derived?.required_monthly_progress_pct||0)).slice(0,40),[projects]);return <section className="page-shell"><PageHeader eyebrow="INTELLIGENCE" title="Commitment Stress" subtitle="A portfolio view of the rate required to complete the remaining reported progress within the current commitment." /><div className="stress-grid">{items.slice(0,18).map((p,i)=><button className="stress-row panel-new" key={p.project_code} onClick={()=>onOpen(p)}><div className="stress-rank">{String(i+1).padStart(2,'0')}</div><div className="stress-main"><strong>{p.name}</strong><span>{p.project_code} · {p.state||'—'}</span></div><div className="stress-kpi"><small>Progress</small><b>{pct(p.physical_progress_pct)}</b></div><div className="stress-kpi"><small>Required / month</small><b>{fmtNum(p.derived?.required_monthly_progress_pct,1)} pp</b></div><div className="stress-bar"><i style={{width:`${clamp((p.derived?.required_monthly_progress_pct||0)*10)}%`}}/></div><ChevronRight size={15}/></button>)}</div></section>}

function TrendsPage({trends,changes}:{trends:PortfolioTrends|null;changes:PortfolioChanges|null}){const series=trends?.periods||[];const formatPeriod=(p:string)=>{const [y,m]=p.split('-');return new Date(Number(y),Number(m)-1,1).toLocaleDateString('en-IN',{month:'short',year:'2-digit'})};return <section className="page-shell"><PageHeader eyebrow="INTELLIGENCE" title="Portfolio Trends" subtitle="Historical aggregates across the reporting periods actually present in the Sentinel database." /><div className="trend-grid"><ChartPanel title="Average physical progress" subtitle="Simple mean across reported project snapshots"><ResponsiveContainer width="100%" height={270}><LineChart data={series}><CartesianGrid stroke="#e7ebf0" strokeDasharray="3 3"/><XAxis dataKey="report_period" tickFormatter={formatPeriod}/><YAxis domain={[0,100]}/><Tooltip formatter={(v:any)=>[`${Number(v).toFixed(1)}%`,'Average progress']}/><Line type="monotone" dataKey="avg_progress" stroke="#1565C0" strokeWidth={3} dot={{r:4}}/></LineChart></ResponsiveContainer></ChartPanel><ChartPanel title="Reported project volume" subtitle="Snapshot row count by reporting period"><ResponsiveContainer width="100%" height={270}><BarChart data={series}><CartesianGrid stroke="#e7ebf0" strokeDasharray="3 3"/><XAxis dataKey="report_period" tickFormatter={formatPeriod}/><YAxis/><Tooltip/><Bar dataKey="projects" fill="#0B1F4B" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></ChartPanel><ChartPanel title="Revised cost vs expenditure" subtitle="Reported aggregate values in crore"><ResponsiveContainer width="100%" height={300}><AreaChart data={series}><CartesianGrid stroke="#e7ebf0" strokeDasharray="3 3"/><XAxis dataKey="report_period" tickFormatter={formatPeriod}/><YAxis tickFormatter={(v)=>`₹${Math.round(v/1000)}k`}/><Tooltip formatter={(v:any)=>[money(Number(v))]}/><Area type="monotone" dataKey="revised_cost_crore" stroke="#1565C0" fill="#EAF4FB"/><Area type="monotone" dataKey="expenditure_crore" stroke="#138808" fill="#EEF8EE"/></AreaChart></ResponsiveContainer></ChartPanel><section className="panel-new change-summary-panel"><div className="eyebrow">LATEST CHANGESET</div><h2>{changes?.previous_period} → {changes?.current_period}</h2><div className="change-stat-grid"><div><strong>{fmtInt(changes?.summary.progress_moved)}</strong><span>progress moved</span></div><div><strong>{fmtInt(changes?.summary.negative_progress)}</strong><span>negative movements</span></div><div><strong>{fmtInt(changes?.summary.completion_revised)}</strong><span>commitment revisions</span></div><div><strong>{fmtInt(changes?.summary.cost_revised)}</strong><span>cost changes</span></div></div><div className="change-note"><ShieldCheck size={14}/> Metrics describe observed reporting changes; they are not outcome predictions.</div></section></div></section>}
function ChartPanel({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}){return <section className="panel-new chart-panel-new"><div className="panel-title-row"><div><div className="eyebrow">ANALYTICS</div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>}

function ComparePage({projects,selected,setSelected,onOpen}:{projects:Project[];selected:Project[];setSelected:(p:Project[])=>void;onOpen:(p:Project|string)=>void}){
  const [a,setA]=useState(selected[0]?.project_code||'');const [b,setB]=useState(selected[1]?.project_code||'');const [trajs,setTrajs]=useState<Record<string,TrajectoryIntelligence>>({})
  useEffect(()=>{setA(selected[0]?.project_code||'');setB(selected[1]?.project_code||'')},[selected])
  useEffect(()=>{
    const wanted=[a,b].filter(Boolean);if(!wanted.length)return
    Promise.all(wanted.map(async code=>[code,await client.trajectory(code)] as const)).then(entries=>setTrajs(prev=>({...prev,...Object.fromEntries(entries)}))).catch(()=>{})
  },[a,b])
  const choose=(code:string,slot:'a'|'b')=>{slot==='a'?setA(code):setB(code);const pa=projects.find(p=>p.project_code===(slot==='a'?code:b));const pb=projects.find(p=>p.project_code===(slot==='b'?code:a));const list=[pa,pb].filter(Boolean) as Project[];setSelected(list.slice(0,2))}
  const left=projects.find(p=>p.project_code===a);const right=projects.find(p=>p.project_code===b);const ta=trajs[a];const tb=trajs[b]
  return <section className="page-shell"><PageHeader eyebrow="INTELLIGENCE" title="Project Comparison" subtitle="Put two observed project trajectories and latest-state metrics side by side." actions={selected.length>0?<button className="btn secondary" onClick={()=>setSelected([])}>Clear comparison</button>:undefined}/><div className="compare-selectors panel-new"><ProjectSelect label="PROJECT A" value={a} projects={projects} onChange={v=>choose(v,'a')}/><div className="vs-badge">VS</div><ProjectSelect label="PROJECT B" value={b} projects={projects} onChange={v=>choose(v,'b')}/></div>{left&&right?<><div className="compare-cards"><CompareHero p={left} accent="blue" onOpen={onOpen}/><CompareHero p={right} accent="saffron" onOpen={onOpen}/></div><div className="panel-new compare-metrics"><div className="eyebrow">SIDE-BY-SIDE METRICS</div><div className="compare-table"><div className="compare-head"><span>Metric</span><strong>A</strong><strong>B</strong></div>{[['Physical progress',pct(left.physical_progress_pct),pct(right.physical_progress_pct)],['Latest progress change',left.derived?.progress_delta_pct==null?'—':`${left.derived.progress_delta_pct>=0?'+':''}${left.derived.progress_delta_pct.toFixed(1)} pp`,right.derived?.progress_delta_pct==null?'—':`${right.derived.progress_delta_pct>=0?'+':''}${right.derived.progress_delta_pct.toFixed(1)} pp`],['Required monthly rate',left.derived?.required_monthly_progress_pct!=null?`${left.derived.required_monthly_progress_pct.toFixed(1)} pp`: '—',right.derived?.required_monthly_progress_pct!=null?`${right.derived.required_monthly_progress_pct.toFixed(1)} pp`:'—'],['Revised cost',money(left.revised_cost_crore),money(right.revised_cost_crore)],['Expenditure',money(left.expenditure_crore),money(right.expenditure_crore)],['Assessment',`${score(left.assessment_score)??'—'}/100`,`${score(right.assessment_score)??'—'}/100`]].map(row=><div className="compare-line" key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong><strong>{row[2]}</strong></div>)}</div></div><div className="panel-new compare-chart"><div className="eyebrow">TRAJECTORY COMPARISON</div><h2>Observed physical progress</h2><p>Only reporting points present in each project's stored history are shown.</p><ResponsiveContainer width="100%" height={360}><LineChart><CartesianGrid stroke="#e7ebf0" strokeDasharray="3 3"/><XAxis dataKey="report_period" allowDuplicatedCategory={false}/><YAxis domain={[0,100]}/><Tooltip formatter={(v:any)=>[`${Number(v).toFixed(1)}%`,'Progress']}/>{ta&&<Line data={ta.trajectory.physical_progress_series} type="monotone" dataKey="physical_progress_pct" name={left.name.slice(0,36)} stroke="#1565C0" strokeWidth={3} dot={{r:4}}/>}{tb&&<Line data={tb.trajectory.physical_progress_series} type="monotone" dataKey="physical_progress_pct" name={right.name.slice(0,36)} stroke="#E67E22" strokeWidth={3} dot={{r:4}}/>}</LineChart></ResponsiveContainer></div></>:<div className="empty-state panel-new"><GitCompareArrows size={26}/><h2>Select two projects</h2><p>Use the selectors above or Compare actions in All Projects / Watchlist.</p></div>}</section>
}
function ProjectSelect({label,value,projects,onChange}:{label:string;value:string;projects:Project[];onChange:(v:string)=>void}){return <label className="project-select"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}><option value="">Choose project…</option>{projects.map(p=><option key={p.project_code} value={p.project_code}>{p.project_code} · {p.name.slice(0,72)}</option>)}</select></label>}
function CompareHero({p,accent,onOpen}:{p:Project;accent:string;onOpen:(p:Project|string)=>void}){return <div className={`compare-hero panel-new ${accent}`}><div className="eyebrow">PROJECT</div><span>{p.project_code}</span><h2>{p.name}</h2><p>{p.state||'—'} · {p.sector||'—'} · {p.ministry||'—'}</p><div className="compare-hero-metrics"><div><span>Progress</span><b>{pct(p.physical_progress_pct)}</b></div><div><span>Assessment</span><b>{score(p.assessment_score)??'—'}/100</b></div><div><span>Revised cost</span><b>{moneyCompact(p.revised_cost_crore)}</b></div></div><button onClick={()=>onOpen(p)}>Open project <ArrowRight size={13}/></button></div>}

function TrustPage({integrity,source,audit,onSync,onBackfill,refreshing}:{integrity:any;source:any;audit:EngineAudit|null;onSync:()=>void;onBackfill:()=>void;refreshing:boolean}){const loc=(audit as any)?.location_coverage||{};const totalFlags=Object.values((integrity.open_flags||{}) as Record<string,number>).reduce((a,b)=>a+Number(b||0),0);return <section className="page-shell"><PageHeader eyebrow="EVIDENCE & TRUST" title="Data Trust Center" subtitle="Source provenance, engine coverage, data-quality observations and location limitations." actions={<div className="page-actions"><button className="btn secondary" onClick={onSync} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/>{refreshing?'Checking…':'Check newest source'}</button><button className="btn orange" onClick={onBackfill} disabled={refreshing}><Database size={15}/>{refreshing?'Checking…':'Verify bundled history'}</button></div>} /><div className="trust-hero panel-new"><div className="trust-hero-copy"><div className="verified-mark"><ShieldCheck size={22}/></div><div><div className="eyebrow">EVIDENCE BEFORE INFERENCE</div><h2>{fmtInt(audit?.evaluated_count)} / {fmtInt(audit?.total_latest_projects)} latest projects assessed</h2><p>Reference-class attention engine. Current values indicate relative monitoring attention, not failure probability.</p></div></div><div className="trust-score"><strong>{fmtNum(audit?.coverage_pct,1)}%</strong><span>coverage</span></div></div><div className="trust-cards"><TrustMetric label="Open QA observations" value={fmtInt(totalFlags)} tone="warning"/><TrustMetric label="Critical attention band" value={fmtInt(audit?.band_counts?.critical)} tone="critical"/><TrustMetric label="Engine code hash" value={audit?.engine_code_hash||'—'} tone="neutral"/><TrustMetric label="Result checksum" value={audit?.result_checksum?.slice(0,16)||'—'} tone="neutral"/></div><div className="trust-grid-large"><section className="panel-new"><div className="eyebrow">LOCATION COVERAGE</div><div className="location-bars"><TrustBar label="Exact source GPS" value={loc.exact_gps||0} total={audit?.total_latest_projects||1} tone="blue"/><TrustBar label="Administrative / state context" value={loc.state_context||0} total={audit?.total_latest_projects||1} tone="saffron"/><TrustBar label="Unavailable" value={loc.unavailable||0} total={audit?.total_latest_projects||1} tone="muted"/></div><p className="note-box"><CircleHelp size={14}/> Administrative context is not presented as exact project geography.</p></section><section className="panel-new"><div className="eyebrow">OPEN DATA-QUALITY FLAGS</div><div className="flag-list">{Object.entries(integrity.open_flags||{}).map(([k,v])=><div className="flag-row-new" key={k}><div><strong>{k.replaceAll('_',' ')}</strong><span>Deterministic QA observation</span></div><b>{fmtInt(Number(v))}</b></div>)}</div></section></div><section className="panel-new"><div className="panel-title-row"><div><div className="eyebrow">PROVENANCE</div><h2>Source snapshot</h2></div><a className="inline-btn" href="https://paimana-proj.mospi.gov.in/" target="_blank" rel="noreferrer">Open PAIMANA <ExternalLink size={13}/></a></div><div className="provenance-grid"><InfoRow label="Source" value={source?.latest_report?.source_name||'MoSPI / PAIMANA'}/><InfoRow label="Latest report" value={source?.latest_report?.report_period||'—'}/><InfoRow label="Reporting cutoff" value={source?.latest_report?.reporting_cutoff||'—'}/><InfoRow label="Source rows" value={fmtInt(source?.latest_report?.row_count)}/><InfoRow label="Stored history" value={`${source?.history?.earliest_period||'—'} → ${source?.history?.latest_period||'—'}`}/><InfoRow label="Snapshots" value={fmtInt(source?.history?.snapshots)}/><InfoRow label="Source releases" value={fmtInt(source?.history?.source_releases)}/><InfoRow label="Engine" value={`${audit?.engine_name||'—'} · ${audit?.engine_version||'—'}`}/></div></section><section className="panel-new"><div className="eyebrow">HISTORICAL COVERAGE</div><div className="history-coverage-line"><strong>{source?.history?.earliest_period||'—'}</strong><i/><strong>{source?.history?.latest_period||'—'}</strong></div><div className="history-coverage-meta"><span>{fmtInt(source?.history?.reporting_periods)} reporting periods</span><span>{fmtInt(source?.history?.snapshots)} stored snapshots</span><span>{fmtInt(source?.history?.source_releases)} release records</span></div><p className="note-box"><Database size={14}/> Historical snapshots are bundled from the stored PAIMANA release inventory; the active assessment remains frozen at April 2026.</p></section></section>}
function TrustMetric({label,value,tone}:{label:string;value:string;tone:string}){return <div className={`trust-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>}
function TrustBar({label,value,total,tone}:{label:string;value:number;total:number;tone:string}){const p=total?value/total*100:0;return <div className="trust-bar"><div><span>{label}</span><strong>{fmtInt(value)} <small>({p.toFixed(1)}%)</small></strong></div><i className={tone}><b style={{width:`${clamp(p)}%`}}/></i></div>}
function InfoRow({label,value}:{label:string;value:string}){return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>}

function SourcesPage({source,onSync,onBackfill,refreshing}:{source:any;onSync:()=>void;onBackfill:()=>void;refreshing:boolean}){return <section className="page-shell"><PageHeader eyebrow="EVIDENCE" title="Source & Releases" subtitle="Track the reporting snapshot, sync state and source lifecycle used by Sentinel." actions={<div className="page-actions"><button className="btn secondary" onClick={onSync} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/>{refreshing?'Checking…':'Check newest source'}</button><button className="btn orange" onClick={onBackfill} disabled={refreshing}><Database size={15}/>{refreshing?'Checking…':'Verify bundled history'}</button></div>} /><div className="release-hero panel-new"><div className="release-badge"><Database size={18}/></div><div><div className="eyebrow">LATEST AVAILABLE RELEASE</div><h2>{source?.latest_report?.report_period||'—'}</h2><p>{source?.sync?.message||'Source snapshot status unavailable.'}</p></div><div className="sync-state"><span className={`sync-dot ${source?.sync?.status==='error'?'bad':'ok'}`}/><strong>{source?.sync?.status||'—'}</strong><small>{source?.sync?.last_run?new Date(source.sync.last_run).toLocaleString('en-IN'):''}</small></div></div><div className="source-table panel-new"><div className="panel-title-row"><div><div className="eyebrow">RELEASE RECORD</div><h2>PAIMANA source metadata</h2></div></div><div className="provenance-grid"><InfoRow label="Source name" value={source?.latest_report?.source_name||'PAIMANA Monthly Flash Report'}/><InfoRow label="Report period" value={source?.latest_report?.report_period||'—'}/><InfoRow label="Reporting cutoff" value={source?.latest_report?.reporting_cutoff||'—'}/><InfoRow label="Published" value={source?.latest_report?.published_at?dateFmt(source.latest_report.published_at):'—'}/><InfoRow label="Imported rows" value={fmtInt(source?.latest_report?.row_count)}/><InfoRow label="SHA-256" value={source?.latest_report?.file_sha256||'—'}/></div><div className="release-inventory"><div className="eyebrow">HISTORICAL RELEASE INVENTORY</div><div className="release-table"><div className="release-row release-head"><span>Period</span><span>Type</span><span>Title</span><span>Status</span></div>{(source?.releases||[]).map((r:any)=><div className="release-row" key={r.id}><span>{r.report_period||'—'}</span><span>{r.report_type||'other'}</span><span title={r.title}>{r.title}</span><span className={`release-status ${r.status||'discovered'}`}>{r.status||'discovered'}</span></div>)}{!(source?.releases||[]).length&&<div className="empty-inline">No release inventory has been recorded yet. The bundle already includes its stored release inventory.</div>}</div></div><div className="source-links"><a href={source?.official_dashboard_url} target="_blank" rel="noreferrer">Official PAIMANA dashboard <ExternalLink size={13}/></a><a href={source?.reports_url} target="_blank" rel="noreferrer">Official reports <ExternalLink size={13}/></a></div></div></section>}

function BriefPage({portfolio,changes,audit,source,projects,onExport}:{portfolio:Portfolio|null;changes:PortfolioChanges|null;audit:EngineAudit|null;source:any;projects:Project[];onExport:()=>void}){const mean=projects.length?projects.reduce((s,p)=>s+(p.physical_progress_pct||0),0)/projects.length:null;const attention=portfolio?.attention_bands?.elevated_or_higher||0;return <section className="page-shell brief-page"><PageHeader eyebrow="ANALYTICAL TOOLS" title="National Monitoring Brief" subtitle="A structured, source-aware briefing page generated from the current Sentinel snapshot." actions={<><button className="btn secondary" onClick={onExport}><Download size={15}/>Export CSV</button><button className="btn primary" onClick={()=>window.print()}><FileText size={15}/>Print / save PDF</button></>} /><article className="brief-paper panel-new"><div className="brief-ribbon"><span>PAIMANA SENTINEL</span><b>National infrastructure project brief</b><span>Reporting period · {portfolio?.report_period||'—'}</span></div><div className="brief-title"><div><div className="eyebrow">MO SPI / PAIMANA</div><h2>National Portfolio Brief</h2><p>Evidence-backed summary of the latest available reporting snapshot.</p></div><div className="brief-seal"><ShieldCheck size={22}/><span>Source aware</span></div></div><div className="brief-metrics"><div><span>Projects</span><strong>{fmtInt(portfolio?.project_count)}</strong></div><div><span>Revised cost</span><strong>{moneyCompact(portfolio?.revised_cost_crore)}</strong></div><div><span>Expenditure</span><strong>{moneyCompact(portfolio?.expenditure_crore)}</strong></div><div><span>Mean progress</span><strong>{pct(mean)}</strong></div></div><BriefSection title="Portfolio movement"><p>Between {changes?.previous_period||'the previous snapshot'} and {changes?.current_period||'the latest snapshot'}, <strong>{fmtInt(changes?.summary.progress_moved)}</strong> projects reported a physical-progress change where both periods were available, while <strong>{fmtInt(changes?.summary.stagnant_progress)}</strong> reported no change.</p><div className="brief-list"><div><i/>Positive progress movement: <strong>{fmtInt(changes?.summary.positive_progress)}</strong></div><div><i/>Negative progress movement observed: <strong>{fmtInt(changes?.summary.negative_progress)}</strong></div><div><i/>Completion-date revisions observed: <strong>{fmtInt(changes?.summary.completion_revised)}</strong></div><div><i/>Reported revised-cost changes: <strong>{fmtInt(changes?.summary.cost_revised)}</strong></div></div></BriefSection><BriefSection title="Assessment coverage"><p>Sentinel evaluated <strong>{fmtInt(audit?.evaluated_count)}</strong> of <strong>{fmtInt(audit?.total_latest_projects)}</strong> latest projects using the reference-class attention engine. The assessment is an analytical score, not a validated probability.</p></BriefSection><BriefSection title="Data trust"><p>Source: <strong>{source?.latest_report?.source_name||'MoSPI / PAIMANA'}</strong>. Latest reporting period: <strong>{source?.latest_report?.report_period||'—'}</strong>. Location limitations are preserved where project-level geography is unavailable.</p></BriefSection><div className="brief-footer"><span>Generated from the current Sentinel data layer.</span><span>Assessment semantics: reference-class attention score.</span></div></article></section>}
function BriefSection({title,children}:{title:string;children:ReactNode}){return <section className="brief-section"><h3>{title}</h3>{children}</section>}

function ProjectPage({project,loading,timeline,trajectory,comparables,evidence,onBack,onCompare,comparing,onCitizen,onWhy}:{project:Project;loading:boolean;timeline:TimelineItem[];trajectory:TrajectoryIntelligence|null;comparables:Comparable[];evidence:Evidence|null;onBack:()=>void;onCompare:()=>void;comparing:boolean;onCitizen:()=>void;onWhy:()=>void}){
  const [tab,setTab]=useState<'overview'|'trajectory'|'commitment'|'stress'|'history'|'evidence'>('overview')
  const t=trajectory?.trajectory
  const latestDelta=t?.progress_deltas?.length?t.progress_deltas[t.progress_deltas.length-1]:null
  const bandValue=project.assessment_band||band(project.assessment_score)
  const latestMovement = latestDelta ? `${latestDelta.progress_delta_pct>=0?'+':''}${latestDelta.progress_delta_pct.toFixed(1)} pp` : '—'
  const requiredRate = project.derived?.required_monthly_progress_pct
  const revisionCount = t?.commitment_revision_count ?? project.derived?.revision_count_to_date ?? project.metrics?.commitment_revisions ?? 0
  return <section className="page-shell"><div className="breadcrumb"><span className={`detail-sync-pill ${loading?'loading':'ready'}`}><span/>{loading?'Loading project dossier…':'Project dossier ready'}</span><button onClick={onBack}><ArrowLeft size={14}/>Back to previous view</button><span>/</span><strong>{project.project_code}</strong></div><div className="project-hero panel-new"><div><div className="eyebrow">PROJECT INTELLIGENCE</div><h1>{project.name}</h1><p>{project.state||'India'} · {project.sector||'—'} · {project.ministry||'—'}</p><div className="hero-tags"><span>{project.project_code}</span><span>{project.report_period||'—'}</span><span>{project.location_status==='exact_gps'?'Exact source location':project.location_status==='unavailable'?'Location unavailable':'Administrative context'}</span>{project.reference_class&&<span>{referenceClassLabel(project.reference_class)} · {fmtInt(project.reference_class.peer_count)} peers</span>}</div></div><div className="project-head-actions"><button className="btn secondary" onClick={onCitizen}><Users size={15}/>Public view</button><button className={`btn ${comparing?'primary':'secondary'}`} onClick={onCompare}><GitCompareArrows size={15}/>{comparing?'In comparison':'Compare'}</button></div></div><div className="project-kpis"><ProjectKpi label="Physical progress" value={pct(project.physical_progress_pct)} icon={<TrendingUp size={16}/>} /><ProjectKpi label="Revised cost" value={moneyCompact(project.revised_cost_crore)} icon={<Landmark size={16}/>} /><ProjectKpi label="Expenditure" value={moneyCompact(project.expenditure_crore)} icon={<BarChart3 size={16}/>} /><ProjectKpi label="Attention score" value={`${score(project.assessment_score)??'—'}/100`} sub={bandLabel(bandValue)} icon={<Gauge size={16}/>} accent={bandValue}/> <ProjectKpi label="Current completion" value={dateFmt(project.revised_end_date||project.original_end_date)} icon={<CalendarClock size={16}/>} /></div><ProjectSignalRail project={project} latestMovement={latestMovement} revisionCount={revisionCount} requiredRate={requiredRate} historyLength={t?.history_length ?? timeline.length} /><div className="stage-strip"><Stage active label="Assess" text="Reported state" current={tab==='overview'} onClick={()=>setTab('overview')}/><Stage active={!!evidence} label="Diagnose" text="Evidence & signals" current={tab==='evidence'} onClick={()=>setTab('evidence')}/><Stage active={!!trajectory} label="Stress" text="Required recovery rate" current={tab==='stress'} onClick={()=>setTab('stress')}/><Stage active={comparables.length>0} label="Recover" text="Comparable context" current={tab==='history'} onClick={()=>setTab('history')}/></div><div className="project-tabs">{[['overview','Overview'],['trajectory','Trajectory intelligence'],['commitment','Commitment'],['stress','Commitment stress'],['history','Historical recovery'],['evidence','Evidence']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id as any)}>{label}</button>)}</div>{tab==='overview'&&<ProjectOverview project={project} timeline={timeline} latestDelta={latestDelta} onWhy={onWhy}/>} {tab==='trajectory'&&<ProjectTrajectory data={trajectory}/>} {tab==='commitment'&&<ProjectCommitment project={project} data={trajectory}/>} {tab==='stress'&&<ProjectStress project={project} data={trajectory}/>} {tab==='history'&&<ProjectHistory matches={comparables}/>} {tab==='evidence'&&<ProjectEvidence evidence={evidence}/>}</section>
}
function ProjectKpi({label,value,sub,icon,accent}:{label:string;value:string;sub?:string;icon:ReactNode;accent?:string}){return <div className={`project-kpi ${accent||''}`}><span className="pk-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div></div>}
function ProjectSignalRail({project,latestMovement,revisionCount,requiredRate,historyLength}:{project:Project;latestMovement:string;revisionCount:number;requiredRate?:number|null;historyLength:number}){
  const b=project.assessment_band||band(project.assessment_score)
  return <section className="project-signal-rail"><div className={`signal-rail-card ${b}`}><span className="signal-rail-icon"><Gauge size={14}/></span><div><small>CURRENT ATTENTION</small><strong>{score(project.assessment_score)??'—'}/100</strong><span>{bandLabel(b)} reference-class signal</span></div></div><div className={`signal-rail-card ${latestMovement.startsWith('-')?'negative':'positive'}`}><span className="signal-rail-icon"><Activity size={14}/></span><div><small>LATEST MOVEMENT</small><strong>{latestMovement}</strong><span>{latestMovement==='—'?'No comparable interval':'latest reported interval'}</span></div></div><div className="signal-rail-card saffron"><span className="signal-rail-icon"><CalendarClock size={14}/></span><div><small>COMMITMENT CHANGES</small><strong>{fmtInt(revisionCount)}</strong><span>{revisionCount===1?'revision observed':'revisions observed'}</span></div></div><div className="signal-rail-card blue"><span className="signal-rail-icon"><Zap size={14}/></span><div><small>RECOVERY RATE</small><strong>{requiredRate==null?'—':`${requiredRate.toFixed(1)} pp/mo`}</strong><span>{requiredRate==null?'Derived rate unavailable':'remaining reported progress / commitment'}</span></div></div><div className="signal-rail-source"><ShieldCheck size={14}/><div><strong>{fmtInt(historyLength)} reporting periods in view</strong><span>Read left-to-right: signal → movement → commitment → required rate.</span></div></div></section>
}
function Stage({label,text,active=true,current=false,onClick}:{label:string;text:string;active?:boolean;current?:boolean;onClick?:()=>void}){return <button type="button" className={`stage-step ${active?'active':''} ${current?'current':''}`} onClick={onClick}><span>{active?<Check size={11}/>:''}</span><div><strong>{label}</strong><small>{text}</small></div><ArrowRight size={11}/></button>}
function ProjectOverview({project,timeline,latestDelta,onWhy}:{project:Project;timeline:TimelineItem[];latestDelta:any;onWhy:()=>void}){return <div className="project-content-grid"><section className="panel-new"><div className="panel-title-row"><div><div className="eyebrow">TRAJECTORY</div><h2>Project state over time</h2><p>Actual stored reporting points.</p></div><span className="latest-report-chip">Latest report · {project.report_period||'—'}</span></div><ProgressChart items={timeline}/></section><aside className="stack-col"><section className="panel-new"><div className="eyebrow">OBSERVED FACTS</div>{[['Original cost',money(project.original_cost_crore)],['Revised cost',money(project.revised_cost_crore)],['Expenditure',money(project.expenditure_crore)],['Original completion',dateFmt(project.original_end_date)],['Current completion',dateFmt(project.revised_end_date||project.original_end_date)]].map(([a,b])=><InfoRow key={a} label={a} value={b}/>)}</section><section className="panel-new why-card"><div className="eyebrow">DIAGNOSTIC</div><h3>Why does Sentinel flag this?</h3><p>Open the evidence-separated explanation of the current assessment.</p><button className="btn primary full" onClick={onWhy}><CircleHelp size={15}/>Why?</button></section><section className="panel-new"><div className="eyebrow">LATEST CHANGE</div><div className="change-big">{latestDelta?<><strong>{latestDelta.progress_delta_pct>=0?'+':''}{latestDelta.progress_delta_pct.toFixed(1)} pp</strong><span>{latestDelta.from_period} → {latestDelta.to_period}</span></>:<><strong>—</strong><span>Insufficient comparison</span></>}</div></section></aside></div>}
function ProgressChart({items}:{items:TimelineItem[]}){const data=items.map(x=>({report_period:x.report_period,physical_progress_pct:x.physical_progress_pct}));return <div className="project-chart"><ResponsiveContainer width="100%" height={330}><LineChart data={data}><CartesianGrid stroke="#e7ebf0" strokeDasharray="3 3"/><XAxis dataKey="report_period"/><YAxis domain={[0,100]}/><Tooltip formatter={(v:any)=>[v==null?'—':`${Number(v).toFixed(1)}%`,'Physical progress']}/><Line type="monotone" dataKey="physical_progress_pct" stroke="#1565C0" strokeWidth={3} dot={{r:5,strokeWidth:2,fill:'#fff'}} connectNulls={false}/></LineChart></ResponsiveContainer></div>}
function ProjectTrajectory({data}:{data:TrajectoryIntelligence|null}){const [window,setWindow]=useState<'full'|'12m'|'24m'|'5y'>('full');if(!data)return <div className="empty-state panel-new"><TrendingUp size={26}/><h2>Trajectory unavailable</h2><p>No trajectory payload was returned by the backend.</p></div>;const t=data.trajectory;const latestPeriod=t.report_periods?.[t.report_periods.length-1];const monthIndex=(p:string)=>{const [y,m]=p.slice(0,7).split('-').map(Number);return y*12+m};const cutoff=latestPeriod?monthIndex(latestPeriod):null;const windowMonths=window==='12m'?12:window==='24m'?24:window==='5y'?60:null;const visibleSeries=windowMonths&&cutoff?t.physical_progress_series.filter(x=>monthIndex(x.report_period)>=cutoff-windowMonths+1):t.physical_progress_series;return <div className="project-section-stack"><section className="panel-new"><div className="panel-title-row"><div><div className="eyebrow">TRAJECTORY INTELLIGENCE</div><h2>Observed physical-progress trajectory</h2><p>Descriptive features derived from the complete stored reporting history.</p></div><div className="trajectory-meta-actions"><span className="data-sufficiency">{t.trajectory_data_quality.status.replaceAll('_',' ')}</span><span className="latest-report-chip">{t.report_periods?.[0]||'—'} → {t.report_periods?.[t.report_periods.length-1]||'—'}</span><select className="history-select" value={window} onChange={e=>setWindow(e.target.value as any)}><option value="full">Full history</option><option value="5y">Last 5 years</option><option value="24m">Last 24 months</option><option value="12m">Last 12 months</option></select></div></div><ProgressChart items={visibleSeries.map(x=>({report_period:x.report_period,physical_progress_pct:x.physical_progress_pct}))}/><div className="feature-grid">{[['History length',`${t.history_length} periods`],['Mean monthly velocity',t.mean_monthly_velocity==null?'—':`${t.mean_monthly_velocity.toFixed(2)} pp/mo`],['Latest velocity',t.latest_monthly_velocity==null?'—':`${t.latest_monthly_velocity.toFixed(2)} pp/mo`],['Velocity change',t.velocity_change==null?'—':`${t.velocity_change>=0?'+':''}${t.velocity_change.toFixed(2)} pp/mo`],['Positive periods',fmtInt(t.positive_progress_periods)],['Zero-progress periods',fmtInt(t.zero_progress_periods)],['Negative periods',fmtInt(t.negative_progress_periods)],['Maximum gain',t.maximum_progress_gain==null?'—':`+${t.maximum_progress_gain.toFixed(2)} pp`],['Maximum drop',t.maximum_progress_drop==null?'—':`${t.maximum_progress_drop.toFixed(2)} pp`]].map(([a,b])=><div className="feature-box" key={a}><span>{a}</span><strong>{b}</strong></div>)}</div></section><section className="panel-new"><div className="eyebrow">OBSERVED INTERVALS</div><div className="interval-list">{t.progress_deltas.map(d=><div className="interval-row" key={`${d.from_period}-${d.to_period}`}><span>{d.from_period} → {d.to_period}</span><b className={d.progress_delta_pct<0?'negative':''}>{d.progress_delta_pct>=0?'+':''}{d.progress_delta_pct.toFixed(2)} pp</b><small>{d.monthly_velocity_pct>=0?'+':''}{d.monthly_velocity_pct.toFixed(2)} pp/mo · {d.elapsed_months} month(s)</small></div>)}</div></section></div>}
function ProjectCommitment({project,data}:{project:Project;data:TrajectoryIntelligence|null}){const revisions=data?.trajectory.commitment_revisions||[];return <div className="project-section-stack"><section className="panel-new"><div className="eyebrow">COMMITMENT PATHWAY</div><h2>Original → revised completion</h2><div className="commitment-line"><CommitNode label="Original target" date={dateFmt(project.original_end_date)} first/><span className="timeline-rail"/>{revisions.map((r,i)=><div key={`${r.from_period}-${r.to_period}`} className="commit-node-wrap"><CommitNode label={`Revision ${i+1}`} date={dateFmt(r.to_date)} detail={`${r.signed_change_months>=0?'+':''}${r.signed_change_months} month(s)`}/><span className="timeline-rail"/></div>)}<CommitNode label="Current revised target" date={dateFmt(project.revised_end_date||project.original_end_date)} last/></div></section><section className="panel-new"><div className="eyebrow">REVISION REGISTER</div>{revisions.length?revisions.map(r=><div className="revision-row" key={`${r.from_period}-${r.to_period}`}><span>{r.from_period} → {r.to_period}</span><strong>{dateFmt(r.from_date)} → {dateFmt(r.to_date)}</strong><b className={r.signed_change_months<0?'negative':''}>{r.signed_change_months>=0?'+':''}{r.signed_change_months} months</b></div>):<div className="empty-inline">No observed change between non-null revised completion dates in the stored trajectory.</div>}</section></div>}
function CommitNode({label,date,detail,first,last}:{label:string;date:string;detail?:string;first?:boolean;last?:boolean}){return <div className={`commit-node ${first?'first':''} ${last?'last':''}`}><span className="commit-dot"/><div><small>{label}</small><strong>{date}</strong>{detail&&<em>{detail}</em>}</div></div>}
function ProjectStress({project,data}:{project:Project;data:TrajectoryIntelligence|null}){const t=data?.trajectory;const required=project.derived?.required_monthly_progress_pct;const observed=t?.mean_monthly_velocity;const gap=required!=null&&observed!=null?required-observed:null;return <div className="stress-detail-grid"><section className="panel-new stress-gauge-panel"><div className="eyebrow">STRESS</div><h2>Required recovery rate</h2><p>Derived from remaining reported progress and the current reported completion commitment.</p><div className="stress-rate"><strong>{required==null?'—':required.toFixed(2)}</strong><span>pp / month required</span></div><div className="rate-compare"><div><span>Required</span><b>{required==null?'—':required.toFixed(2)} pp/mo</b><i className="req"><b style={{width:`${clamp((required||0)*10)}%`}}/></i></div><div><span>Mean observed velocity</span><b>{observed==null?'—':observed.toFixed(2)} pp/mo</b><i><b style={{width:`${clamp(Math.max(0,(observed||0)*10))}%`}}/></i></div></div>{gap!=null?<div className={`gap-callout ${gap>0?'pressure':'relief'}`}><strong>{gap>=0?'+':''}{gap.toFixed(2)} pp/mo</strong><span>{gap>0?'Additional rate above mean observed velocity':'Mean observed velocity is at or above the required rate'}</span></div>:<div className="note-box"><CircleHelp size={14}/> A comparable observed rate is unavailable.</div>}</section><section className="panel-new stress-facts"><div className="eyebrow">STRESS FACTORS</div><InfoRow label="Current physical progress" value={pct(project.physical_progress_pct)}/><InfoRow label="Remaining progress" value={project.physical_progress_pct==null?'—':`${Math.max(0,100-project.physical_progress_pct).toFixed(1)} pp`}/><InfoRow label="Months remaining" value={fmtInt(project.derived?.months_remaining)}/><InfoRow label="Current commitment" value={dateFmt(project.revised_end_date||project.original_end_date)}/><InfoRow label="Observed history" value={t?.history_length?`${t.history_length} reporting periods`:'—'}/><div className="note-box"><ShieldCheck size={14}/> Stress is a derived requirement, not a forecast of failure.</div></section></div>}
function ProjectHistory({matches}:{matches:Comparable[]}){return <div className="project-section-stack"><section className="panel-new"><div className="panel-title-row"><div><div className="eyebrow">HISTORICAL RECOVERY</div><h2>Projects with similar observed states</h2><p>Current matching logic is descriptive and uses the available trajectory data.</p></div></div><div className="comparables-list">{matches.length?matches.map(m=><div className="comparable-row" key={m.project_code}><div><span>{m.project_code}</span><strong>{m.name}</strong><small>{m.state||'—'} · {m.sector||'—'}</small></div><div><small>Similarity</small><b>{Math.round(m.similarity*100)}%</b></div><div><small>Common periods</small><b>{m.common_interval_count}</b></div><div className="match-reasons">{m.match_reasons.slice(0,3).map(x=><span key={x}>{x}</span>)}</div></div>):<div className="empty-inline">No comparable trajectories were returned for this project.</div>}</div></section></div>}
function ProjectEvidence({evidence}:{evidence:Evidence|null}){if(!evidence)return <div className="empty-state panel-new"><FileCheck2 size={26}/><h2>Evidence unavailable</h2></div>;const groups:[string,string[]][]=[['Observed facts',evidence.observed_facts],['Derived indicators',evidence.derived_indicators],['Assessment output',evidence.model_output],['Historical evidence',evidence.historical_evidence]];return <div className="project-section-stack"><div className="evidence-grid">{groups.map(([title,items])=><section className="panel-new evidence-box" key={title}><div className="eyebrow">{title}</div>{items.map(x=><div className="evidence-item" key={x}><i/><span>{x}</span></div>)}</section>)}</div><section className="panel-new"><div className="eyebrow">PROVENANCE</div><div className="provenance-grid">{Object.entries(evidence.provenance||{}).map(([k,v])=><InfoRow key={k} label={k.replaceAll('_',' ')} value={String(v||'—')}/>)}</div></section></div>}

function CitizenPage({project,data,lang,setLang,onBack}:{project:Project;data:any;lang:'en'|'hi'|'ta';setLang:(v:'en'|'hi'|'ta')=>void;onBack:()=>void}){const progress=data?.status?.physical_progress_pct??project.physical_progress_pct;const labels=lang==='hi'?{progress:'वर्तमान भौतिक प्रगति',cost:'संशोधित लागत',exp:'व्यय',complete:'अपेक्षित पूर्णता'}:lang==='ta'?{progress:'தற்போதைய உடல் முன்னேற்றம்',cost:'திருத்திய செலவு',exp:'செலவினம்',complete:'எதிர்பார்க்கப்படும் நிறைவு'}:{progress:'Current physical progress',cost:'Revised cost',exp:'Expenditure',complete:'Expected completion'};return <section className="page-shell citizen-page-new"><div className="citizen-top"><button className="back-link-new" onClick={onBack}><ArrowLeft size={14}/>Back to project</button><div className="language-switch">{[['en','EN'],['hi','हिन्दी'],['ta','தமிழ்']].map(([v,l])=><button key={v} className={lang===v?'active':''} onClick={()=>setLang(v as any)}>{l}</button>)}</div></div><div className="citizen-banner"><div><div className="eyebrow">BHARAT INFRASTRUCTURE · PUBLIC VIEW</div><h1>{data?.project?.name||project.name}</h1><p>{data?.project?.state||project.state} · {data?.project?.sector||project.sector}</p></div><span><ShieldCheck size={14}/> Official project facts</span></div><div className="citizen-grid-new"><section className="panel-new citizen-progress-card"><div className="eyebrow">PROJECT STATUS</div><strong>{pct(progress)}</strong><span>{labels.progress}</span><i><b style={{width:`${clamp(progress||0)}%`}}/></i><div className="citizen-facts-new">{[[labels.cost,money(data?.status?.revised_cost_crore??project.revised_cost_crore)],[labels.exp,money(data?.status?.expenditure_crore??project.expenditure_crore)],[labels.complete,dateFmt(data?.status?.expected_completion??project.revised_end_date)]].map(([a,b])=><div key={a}><span>{a}</span><strong>{b}</strong></div>)}</div></section><div className="citizen-source-card panel-new"><div className="eyebrow">SOURCE</div><h2>{data?.source?.report_period||project.report_period||'—'}</h2><p>Latest available PAIMANA reporting snapshot.</p><a href="https://paimana-proj.mospi.gov.in/" target="_blank" rel="noreferrer">Open official PAIMANA <ExternalLink size={13}/></a></div></div><div className="citizen-note"><ShieldCheck size={14}/> Public view presents reported project facts. Internal Sentinel assessment signals are not shown here.</div></section>}

function AnalystPage({lang,setLang}:{lang:'en'|'hi'|'ta';setLang:(v:'en'|'hi'|'ta')=>void}){return <section className="page-shell"><PageHeader eyebrow="ANALYTICAL TOOLS" title="Sentinel Analyst" subtitle="Ask grounded questions about the available PAIMANA portfolio and its stored history." actions={<div className="language-switch small">{[['en','EN'],['hi','हिन्दी'],['ta','தமிழ்']].map(([v,l])=><button key={v} className={lang===v?'active':''} onClick={()=>setLang(v as any)}>{l}</button>)}</div>} /><AnalystWorkspace lang={lang}/></section>}
function AnalystWorkspace({lang}:{lang:'en'|'hi'|'ta'}){const [input,setInput]=useState('');const [busy,setBusy]=useState(false);const [messages,setMessages]=useState<{role:'assistant'|'user';text:string;meta?:string}[]>([{role:'assistant',text:'Ask about the PAIMANA portfolio, full project history, trajectories, commitment changes, cost, or data trust.',meta:'Grounded Sentinel Analyst'}]);const send=async()=>{const q=input.trim();if(!q||busy)return;setMessages(m=>[...m,{role:'user',text:q}]);setInput('');setBusy(true);try{const r=await client.ai(q,lang);setMessages(m=>[...m,{role:'assistant',text:r.answer,meta:r.meta}])}catch(e){setMessages(m=>[...m,{role:'assistant',text:'The Sentinel backend did not return an answer.',meta:e instanceof Error?e.message:'Connection issue'}])}finally{setBusy(false)}};const prompts=['Show the full progress history of this project.','When was its first completion-date revision?','Which projects show long-duration stagnation?','Which states have the most commitment revisions?'];return <div className="analyst-workspace panel-new"><aside className="analyst-prompts"><div className="eyebrow">SUGGESTED QUESTIONS</div>{prompts.map(p=><button key={p} onClick={()=>setInput(p)}>{p}<ArrowUpRight size={13}/></button>)}<div className="analyst-note"><ShieldCheck size={14}/><span>Answers should stay grounded in the active source layer.</span></div></aside><section className="analyst-chat"><div className="chat-messages">{messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}><div className="chat-avatar">{m.role==='assistant'?<Bot size={14}/>:<span>YOU</span>}</div><div><div className="chat-text">{m.text}</div>{m.meta&&<small>{m.meta}</small>}</div></div>)}{busy&&<div className="chat-message assistant"><div className="chat-avatar"><Bot size={14}/></div><div className="typing">Working with the current data layer…</div></div>}</div><div className="chat-input"><textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask Sentinel…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}/><button onClick={send} disabled={busy}><Send size={16}/></button></div></section></div>}

function AnalystDrawer({onClose,lang}:{onClose:()=>void;lang:'en'|'hi'|'ta'}){return <div className="overlay"><aside className="side-drawer analyst-drawer"><div className="drawer-header"><div><div className="eyebrow">SENTINEL ANALYST</div><h2>Ask the portfolio</h2></div><button className="close-btn" onClick={onClose}><X size={17}/></button></div><AnalystWorkspace lang={lang}/></aside></div>}

function GlobalSearch({projects,query,setQuery,onClose,onOpen,onNavigate}:{projects:Project[];query:string;setQuery:(s:string)=>void;onClose:()=>void;onOpen:(p:Project|string)=>void;onNavigate:(v:View)=>void}){const needle=query.toLowerCase();const matches=useMemo(()=>projects.filter(p=>[p.project_code,p.name,p.state,p.sector,p.ministry].join(' ').toLowerCase().includes(needle)).slice(0,14),[projects,needle]);return <div className="overlay search-overlay"><div className="search-command"><div className="command-head"><Search size={16}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search projects, states, ministries…"/><kbd>ESC</kbd></div><div className="command-links"><button onClick={()=>{onNavigate('overview');onClose()}}>National Overview</button><button onClick={()=>{onNavigate('map');onClose()}}>Portfolio Map</button><button onClick={()=>{onNavigate('watchlist');onClose()}}>Sentinel Watchlist</button><button onClick={()=>{onNavigate('trust');onClose()}}>Data Trust Center</button></div>{matches.length?<div className="command-results">{matches.map(p=><button key={p.project_code} onClick={()=>{onOpen(p);onClose()}}><span>{p.project_code}</span><strong>{p.name}</strong><small>{p.state||'—'} · {p.sector||'—'}</small><ChevronRight size={14}/></button>)}</div>:<div className="search-empty"><Search size={24}/><strong>No projects found</strong><span>Try a project ID, project name, state or ministry.</span></div>}</div></div>}

function DemoGuide({onClose,onNavigate,onOpenProject,onReset,project,currentView}:{onClose:()=>void;onNavigate:(v:View)=>void;onOpenProject:(p:Project)=>void;onReset:()=>void;project:Project|null;currentView:View}){
  const steps:[string,string,string,()=>void,View[]][]=[
    ['01','Observe','National Overview',()=>onNavigate('overview'),['overview']],
    ['02','Locate','Portfolio Map',()=>onNavigate('map'),['map','watchlist']],
    ['03','Investigate',project?.name||'Open a project',()=>project?onOpenProject(project):onNavigate('watchlist'),['project','trajectory','stress','compare']],
    ['04','Brief','National Monitoring Brief',()=>onNavigate('brief'),['brief']]
  ]
  const status=currentView==='overview'?'Ready at national overview':currentView==='map'?'Portfolio context open':currentView==='project'?'Project investigation open':currentView==='brief'?'Brief ready':'Inside investigation'
  return <div className="overlay demo-overlay"><aside className="side-drawer demo-drawer">
    <div className="drawer-header"><div><div className="eyebrow">PRESENTATION ROUTE</div><h2>Sentinel demo path</h2></div><button className="close-btn" onClick={onClose}><X size={17}/></button></div>
    <div className="demo-intro"><div className="demo-intro-mark"><Workflow size={18}/></div><div><strong>Four screens. One investigation.</strong><span>Use this route to keep a live judging walkthrough tight and repeatable.</span></div></div>
    <div className="demo-route-status"><span className="demo-live-dot"/><strong>{status}</strong><small>Current screen is highlighted below.</small></div>
    <div className="demo-steps">{steps.map(([n,label,meta,go,views])=>{const active=views.includes(currentView);return <button className={`demo-step ${active?'current':''}`} key={n} onClick={()=>go()}><span className="demo-step-num">{n}</span><div><strong>{label}</strong><small>{meta}</small></div>{active?<span className="demo-current-pill">NOW</span>:<ArrowRight size={15}/>}</button>})}</div>
    <div className="demo-tip"><Zap size={14}/><div><strong>Fastest flow</strong><span>Overview → Map → Project → Evidence / Stress → Brief.</span></div></div>
    <button className="demo-reset" onClick={onReset}><RefreshCw size={14}/>Reset judging route to Overview</button>
    <div className="demo-key"><kbd>D</kbd><span>demo route</span><kbd>M</kbd><span>map</span><kbd>W</kbd><span>watchlist</span><kbd>B</kbd><span>brief</span><kbd>ESC</kbd><span>close overlays</span></div>
  </aside></div>
}

function WhyDrawer({project,evidence,trajectory,onClose}:{project:Project;evidence:Evidence|null;trajectory:TrajectoryIntelligence|null;onClose:()=>void}){
  const t=trajectory?.trajectory
  const labels:Record<string,string>={schedule_pressure:'Schedule pressure',velocity_deficit:'Velocity deficit',stagnation:'Stagnation',reversal:'Progress reversal',commitment_slippage:'Commitment movement',cost_revision:'Cost revision',burn_gap:'Spend / progress gap',exposure:'Remaining exposure',data_trust:'Data trust observations'}
  const signals=Object.entries(project.assessment_components||{}).filter(([,v])=>typeof v==='number').sort((a,b)=>(Number(b[1])||0)-(Number(a[1])||0)).slice(0,6)
  return <div className="overlay"><aside className="side-drawer why-drawer">
    <div className="drawer-header"><div><div className="eyebrow">DIAGNOSE</div><h2>Why this project is flagged</h2></div><button className="close-btn" onClick={onClose}><X size={17}/></button></div>
    <div className="why-project"><strong>{project.name}</strong><span>{project.project_code} · {project.state||'—'}</span></div>
    {project.reference_class&&<div className="reference-cohort"><strong>{referenceClassLabel(project.reference_class)}</strong><span>Score is interpreted relative to {fmtInt(project.reference_class.peer_count)} comparable portfolio peers.</span></div>}
    <section className="why-section"><div className="eyebrow">OBSERVED FACTS</div>{(evidence?.observed_facts||[]).map(x=><div className="why-item" key={x}><i className="blue-dot"/><span>{x}</span></div>)}</section>
    <section className="why-section"><div className="eyebrow">TRAJECTORY</div>{(t?.negative_progress_periods||0)>0&&<WhyItem text={`${t?.negative_progress_periods} negative-progress interval(s) observed.`} tone="red"/>}{(t?.zero_progress_periods||0)>0&&<WhyItem text={`${t?.zero_progress_periods} zero-progress interval(s) observed.`} tone="saffron"/>}{(t?.commitment_revision_count||0)>0&&<WhyItem text={`${t?.commitment_revision_count} commitment revision(s) observed.`} tone="saffron"/>}{!(t?.negative_progress_periods||t?.zero_progress_periods||t?.commitment_revision_count)&&<WhyItem text="No trajectory anomaly was returned by the descriptive trajectory endpoint." tone="green"/>}</section>
    {signals.length>0&&<section className="why-section"><div className="eyebrow">ATTENTION SIGNAL BREAKDOWN</div><small className="signal-note">Peer-relative percentile; higher means more unusual within the reference class.</small><div className="attention-signal-grid">{signals.map(([key,value])=><div className="attention-signal" key={key}><div><span>{labels[key]||key.replaceAll('_',' ')}</span><b>{Math.round(Number(value))}</b></div><i><em style={{width:`${clamp(Number(value))}%`}}/></i></div>)}</div></section>}
    <section className="why-section"><div className="eyebrow">DERIVED INDICATORS</div>{(evidence?.derived_indicators||[]).map(x=><div className="why-item" key={x}><i className="blue-dot"/><span>{x}</span></div>)}</section>
    <section className="why-assessment"><div className="eyebrow">ASSESSMENT</div><div className="why-score"><strong>{score(project.assessment_score)??'—'}</strong><span>/100 · {bandLabel(project.assessment_band||band(project.assessment_score))}</span></div><p>Reference-class attention score; not a validated probability.</p></section>
  </aside></div>
}
function WhyItem({text,tone}:{text:string;tone:string}){return <div className="why-item"><i className={`blue-dot ${tone}`}/><span>{text}</span></div>}

function Toast({notice,onClose}:{notice:Notice;onClose:()=>void}){return <div className={`toast ${notice.kind}`}><span>{notice.kind==='success'?<Check size={14}/>:notice.kind==='error'?<AlertCircle size={14}/>:<MonitorCheck size={14}/>}</span><div>{notice.text}</div><button onClick={onClose}><X size={13}/></button></div>}
function ErrorBanner({message,onRetry}:{message:string;onRetry:()=>void}){return <div className="error-banner"><AlertTriangle size={16}/><div><strong>Sentinel backend connection issue</strong><span>{message}</span></div><button onClick={onRetry}>Retry <RefreshCw size={13}/></button></div>}
function LoadingPage(){return <section className="loading-screen"><div className="loading-intro"><div className="loading-mark"><ShieldCheck size={22}/></div><div><div className="loading-kicker">PAIMANA SENTINEL</div><strong>Initialising command centre</strong><span>Loading portfolio, map, historical and source layers…</span></div></div><div className="loading-progress"><i><b/></i><span>Synchronising latest reporting snapshot</span></div><div className="loading-layout"><div><div className="skeleton title"/><div className="skeleton line"/><div className="skeleton hero"/></div><div className="loading-stack">{Array.from({length:5}).map((_,i)=><div className="skeleton-card" key={i}/>)}</div></div></section>}

export default App
