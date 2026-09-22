"""Approved smart-bot rebuild: decisions, resources, controls and real routes."""
import json, os, tempfile, time
from unittest.mock import patch
fd,path=tempfile.mkstemp(suffix='.db'); os.close(fd)
os.environ['DB_PATH']=path; os.environ['DEV_AUTH']='1'
from app import app, _apply_bot_tactics, _bot_choose_weapon, _execute_shot, load_match
from db import get_db, init_db
from game_logic import tower_hp

def setup(tier='expert'):
    with app.app_context(): init_db()
    c=app.test_client(); token=c.post('/api/auth/dev',json={'email':'ubriga@gmail.com','name':'Orel'}).get_json()['token']; h={'Authorization':'Bearer '+token}
    mid=c.post('/api/matches/ai',headers=h,json={'difficulty':tier}).get_json()['match_id']
    return c,h,mid

def test_all_tiers_snapshot_rank_inventory():
    c,h,_=setup()
    for tier in ('easy','medium','hard','ultra','expert'):
        mid=c.post('/api/matches/ai',headers=h,json={'difficulty':tier}).get_json()['match_id']
        d=c.get(f'/api/matches/{mid}/state?since=99',headers=h).get_json()
        assert d['ai_tier']==tier and d['ai_rank_level']>=1
        assert set(d['bot_ammo'])=={'double_bomb','homing_missile','cluster_shell'}

def test_global_and_per_weapon_switches():
    c,h,mid=setup(); controls=c.get('/api/admin/gameplay-controls',headers=h).get_json()['controls']
    for switch in ('special_weapons','double_bomb','homing_missile','cluster_shell'):
        controls['bot_system'].update({'special_weapons':True,'double_bomb':True,'homing_missile':True,'cluster_shell':True})
        controls['bot_system'][switch]=False
        assert c.post('/api/admin/gameplay-controls',headers=h,json={'controls':controls}).status_code==200
        fresh=c.post('/api/matches/ai',headers=h,json={'difficulty':'expert'}).get_json()['match_id']
        with app.app_context():
            m=load_match(fresh); m['state']['wind']=40
            choices={_bot_choose_weapon(m['state']) for _ in range(50)}
            if switch=='special_weapons': assert choices=={'standard'}
            else: assert switch not in choices

def test_reactive_shield_and_tactical_move():
    c,h,mid=setup()
    with app.app_context():
        m=load_match(mid); s=m['state']; s['ai_profile']['move_chance']=1; s['ai_profile']['shield_hp']=1
        old=s['tower_x']['p2']; events=_apply_bot_tactics(m)
        assert any(e['type']=='shield' for e in events)
        assert any(e['type']=='tower_move' for e in events) and s['tower_x']['p2']!=old
        assert s['abilities']['p2']['shield']==0 and s['moves_left']['p2']==0

def test_mega_and_special_weapon_endpoint_chain():
    c,h,mid=setup()
    with app.app_context():
        m=load_match(mid); m['state']['last_shot_at']['p2']=0
        before=m['state']['bot_ammo']['cluster_shell']; mega=m['state']['abilities']['p2']['mega']
        result,error=_execute_shot(m,'p2',45,65,'cluster_shell',True)
        assert not error and m['state']['bot_ammo']['cluster_shell']==before-1
        assert m['state']['abilities']['p2']['mega']==mega-1
        events,_=result
        assert any(e.get('weapon')=='cluster_shell' for e in events)
        assert any(e.get('ability')=='mega' for e in events)
        assert any(e.get('type')=='bot_decision' for e in events)

def test_snapshot_isolation_and_reset():
    c,h,mid=setup('hard'); before=c.get(f'/api/matches/{mid}/state?since=99',headers=h).get_json()['bot_ammo']['double_bomb']
    controls=c.get('/api/admin/gameplay-controls',headers=h).get_json()['controls']; controls['bot_difficulty']['hard_double_ammo']=19
    c.post('/api/admin/gameplay-controls',headers=h,json={'controls':controls})
    assert c.get(f'/api/matches/{mid}/state?since=99',headers=h).get_json()['bot_ammo']['double_bomb']==before
    fresh=c.post('/api/matches/ai',headers=h,json={'difficulty':'hard'}).get_json()['match_id']
    assert c.get(f'/api/matches/{fresh}/state?since=99',headers=h).get_json()['bot_ammo']['double_bomb']==19
    reset=c.post('/api/admin/gameplay-controls',headers=h,json={'reset':True}).get_json()['controls']
    assert reset['bot_difficulty']['hard_double_ammo']==3

if __name__=='__main__':
    try:
        for f in (test_all_tiers_snapshot_rank_inventory,test_global_and_per_weapon_switches,test_reactive_shield_and_tactical_move,test_mega_and_special_weapon_endpoint_chain,test_snapshot_isolation_and_reset): f(); print('PASS',f.__name__)
    finally:
        try: os.unlink(path)
        except OSError: pass
