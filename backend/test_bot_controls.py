"""Bot strength and admin-control regressions."""
import json, os, tempfile
from unittest.mock import patch
fd,path=tempfile.mkstemp(suffix='.db'); os.close(fd)
os.environ['DB_PATH']=path; os.environ['DEV_AUTH']='1'
from app import app, get_gameplay_controls
from db import init_db
from game_logic import new_state, ai_choose_shot

def test_defaults_significantly_stronger():
    with app.app_context():
        c=get_gameplay_controls()['bot_difficulty']
    assert c['easy_angle_noise'] <= 10 and c['medium_angle_noise'] <= 5
    assert c['hard_wind_skill'] >= .9 and c['expert_angle_noise'] <= .5
    assert c['expert_reaction'] <= .2 and c['expert_mega_chance'] >= .9

def test_profiles_bound_accuracy():
    s=new_state({},{}); s['wind']=35; s['ai_tier']='expert'
    p={'angle_noise':.35,'power_spread':.004,'wind_skill':1}
    for _ in range(30):
        a,power,w=ai_choose_shot(s,'p2','ranked',18,p)
        assert 44.65 <= a <= 45.35 and 30 <= power <= 96 and w=='standard'

def test_admin_roundtrip_and_validation():
    with app.app_context(): init_db()
    c=app.test_client(); r=c.post('/api/auth/dev',json={'email':'ubriga@gmail.com','name':'Orel'}); token=r.get_json()['token']; h={'Authorization':'Bearer '+token}
    controls=c.get('/api/admin/gameplay-controls',headers=h).get_json()['controls']
    controls['bot_difficulty']['easy_angle_noise']=7.5
    controls['bot_difficulty']['expert_mega_chance']=.97
    r=c.post('/api/admin/gameplay-controls',headers=h,json={'controls':controls})
    assert r.status_code==200 and r.get_json()['controls']['bot_difficulty']['easy_angle_noise']==7.5
    controls['bot_difficulty']['easy_angle_noise']=99
    assert c.post('/api/admin/gameplay-controls',headers=h,json={'controls':controls}).status_code==400

def test_bot_system_controls_and_match_inventory():
    with app.app_context(): init_db()
    c=app.test_client(); login=c.post('/api/auth/dev',json={'email':'ubriga@gmail.com','name':'Orel'}).get_json(); h={'Authorization':'Bearer '+login['token']}
    controls=c.get('/api/admin/gameplay-controls',headers=h).get_json()['controls']
    assert controls['bot_system']['special_weapons'] is True
    controls['bot_system']['movement']=False
    controls['bot_difficulty']['hard_double_ammo']=7
    assert c.post('/api/admin/gameplay-controls',headers=h,json={'controls':controls}).status_code==200
    mid=c.post('/api/matches/ai',headers=h,json={'difficulty':'hard'}).get_json()['match_id']
    snap=c.get(f'/api/matches/{mid}/state?since=99',headers=h).get_json()
    assert snap['bot_ammo']['double_bomb']==7
    assert snap['bot_tactics']['history']==[]

def test_special_weapon_shared_executor_and_ammo_once():
    with app.app_context(): init_db()
    c=app.test_client(); login=c.post('/api/auth/dev',json={'email':'ubriga@gmail.com','name':'Orel'}).get_json(); h={'Authorization':'Bearer '+login['token']}
    mid=c.post('/api/matches/ai',headers=h,json={'difficulty':'expert'}).get_json()['match_id']
    from app import load_match, _execute_shot
    with app.app_context():
        m=load_match(mid); m['state']['last_shot_at']['p2']=0
        before=m['state']['bot_ammo']['homing_missile']
        result,error=_execute_shot(m,'p2',45,65,'homing_missile',False)
        assert error is None and m['state']['bot_ammo']['homing_missile']==before-1
        events,won=result
        assert any(e.get('type')=='shot' and e.get('weapon')=='homing_missile' for e in events)
        assert any(e.get('type')=='bot_decision' for e in events)

if __name__=='__main__':
    try:
        for f in (test_defaults_significantly_stronger,test_profiles_bound_accuracy,test_admin_roundtrip_and_validation,test_bot_system_controls_and_match_inventory,test_special_weapon_shared_executor_and_ammo_once): f(); print('PASS',f.__name__)
    finally:
        try: os.unlink(path)
        except OSError: pass
