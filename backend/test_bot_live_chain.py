"""End-to-end bot-turn regression through the real Flask match endpoints."""
import os,tempfile,time
fd,path=tempfile.mkstemp(suffix='.db');os.close(fd)
os.environ['DB_PATH']=path;os.environ['DEV_AUTH']='1'
from app import app
from db import init_db

def test_real_endpoint_bot_fires():
    with app.app_context(): init_db()
    c=app.test_client(); login=c.post('/api/auth/dev',json={'email':'ubriga@gmail.com','name':'Orel'}).get_json()
    h={'Authorization':'Bearer '+login['token']}
    mid=c.post('/api/matches/ai',headers=h,json={'difficulty':'expert'}).get_json()['match_id']
    # Force the real endpoint's cooldown/reaction gate open, then call the same
    # state route the browser polls. A unit simulation cannot catch missing
    # imports or orchestration errors in this code path.
    from db import get_db
    import json
    with app.app_context():
        row=get_db().execute('SELECT state FROM matches WHERE id=?',(mid,)).fetchone();s=json.loads(row[0]);s['last_shot_at']['p2']=time.time()-30;get_db().execute('UPDATE matches SET state=? WHERE id=?',(json.dumps(s),mid));get_db().commit()
    snap=c.get(f'/api/matches/{mid}/state?since=0',headers=h)
    assert snap.status_code==200
    data=snap.get_json(); assert data['version']>=2
    shots=[e for e in data.get('events',[]) if e.get('type')=='shot' and e.get('side')=='p2']
    assert shots, data.get('events')
    assert data['last_shot_at']['p2']>s['last_shot_at']['p2']

if __name__=='__main__':
    try:test_real_endpoint_bot_fires();print('PASS real endpoint bot fires')
    finally:
        try:os.unlink(path)
        except OSError:pass
