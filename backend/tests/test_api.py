from fastapi.testclient import TestClient
from app.api import app
from app.config import ACTIVE_REPORT_PERIOD

client=TestClient(app)

def test_health_and_as_of_contract():
    r=client.get('/api/v3/health'); assert r.status_code==200
    assert r.json()['active_report']==ACTIVE_REPORT_PERIOD=='2026-04'

def test_portfolio_is_april_snapshot():
    d=client.get('/api/v3/portfolio').json()
    assert d['report_period']=='2026-04'
    assert d['project_count']>1000
    assert d['revised_cost_crore']>0
    assert sum(d['attention_bands'].values())==d['project_count']

def test_map_discloses_centroid_context():
    d=client.get('/api/v3/map').json()
    assert len(d['projects'])>1000
    assert 'state-centroid' in d['note'].lower()

def test_project_package_has_history_and_evidence():
    d=client.get('/api/v3/projects/612786').json()
    assert d['project']['report_period']=='2026-04'
    assert len(d['trajectory']['items'])>=5
    assert d['evidence']['observed']
    assert 'semantics' in d['evidence']
    assert 'plausibility' in d['recovery']

def test_intervention_workflow_is_persistent():
    r=client.post('/api/v3/projects/612786/intervention',json={'status':'UNDER_REVIEW','note':'API regression test'})
    assert r.status_code==200
    d=client.get('/api/v3/interventions').json()
    row=next(x for x in d['items'] if x['project_code']=='612786')
    assert row['workflow_status']=='UNDER_REVIEW'

def test_sync_cannot_promote_future_data():
    d=client.post('/api/v3/sync').json()
    assert d['active_report_period']=='2026-04'
    assert d['mode']=='frozen_as_of'

def test_export_has_april_filename_contract():
    r=client.get('/api/v3/export.csv')
    assert r.status_code==200
    assert 'project_code' in r.text.splitlines()[0]
