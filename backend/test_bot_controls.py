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

if __name__=='__main__':
    try:
        for f in (test_defaults_significantly_stronger,test_profiles_bound_accuracy,test_admin_roundtrip_and_validation): f(); print('PASS',f.__name__)
    finally:
        try: os.unlink(path)
        except OSError: pass
