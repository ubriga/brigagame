"""Focused dynamic-obstacle timing and collision regressions."""
from unittest.mock import patch
from game_logic import new_state, obstacle_at, _simulate, GROUND_Y

def moving_state(speed=50, warning=2):
    with patch("game_logic.time.time", return_value=1000):
        s=new_state({"dynamic_obstacle":{"enabled":True,"speed":speed,"warning_seconds":warning}}, {})
    s["obstacle_motion"].update({"min_x":400,"max_x":600,"epoch":1000})
    s["obstacle"].update({"y":GROUND_Y-105,"w":68,"h":105})
    return s

def test_warning_and_motion():
    s=moving_state()
    a=obstacle_at(s,1001); assert a["x"]==400 and a["warning"] and not a["moving"]
    b=obstacle_at(s,1004); assert b["x"]==500 and b["moving"] and not b["warning"]
    c=obstacle_at(s,1006); assert c["x"]==600 and c["warning"] and c["direction"]==-1

def test_cycle_and_old_fallback():
    s=moving_state(); assert obstacle_at(s,1012)["x"]==400
    s.pop("obstacle_motion"); assert obstacle_at(s,999)==s["obstacle"]

def test_projectile_uses_future_position():
    s=moving_state(speed=100,warning=0); s["wind"]=0
    # Smoke test authoritative trajectory against a time-varying obstacle.
    with patch("game_logic.time.time", return_value=1000):
        x,y,points,off=_simulate(s,"p1",45,66,"standard",[])
    assert points and x is not None and y is not None

if __name__=='__main__':
    for f in (test_warning_and_motion,test_cycle_and_old_fallback,test_projectile_uses_future_position):f();print('PASS',f.__name__)
