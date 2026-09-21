"""Focused tower-expansion regressions: layout, HP, collision, collapse, compatibility."""
import json
from unittest.mock import patch
from game_logic import (new_state, tower_hp, tower_alive, tower_blocks, muzzle,
                        _simulate, _explode, ai_choose_shot, TOWER_ROWS, TOWER_COLS,
                        BLOCK, GROUND_Y)

def test_expansion_counts_and_hp():
    for extra in (0, 1, 5, 6, 12):
        s = new_state({"extra_cubes": extra, "expansion_cube_hp": 25}, {})
        tower = s["towers"]["p1"]
        assert sum(v is not None for row in tower for v in row) == TOWER_ROWS*TOWER_COLS+extra
        assert tower_hp(s, "p1")["max"] == TOWER_ROWS*TOWER_COLS*18+extra*25
        assert tower_alive(tower)

def test_partial_strip_is_wider_and_collidable():
    s = new_state({"extra_cubes": 1}, {})
    s["wind"] = 0
    assert len(s["towers"]["p1"][0]) == TOWER_COLS+1
    assert s["towers"]["p1"][-1][0] > 0
    assert s["towers"]["p1"][0][0] is None
    x = s["tower_x"]["p1"] + BLOCK/2
    y = GROUND_Y-BLOCK/2
    # Block list exposes the new column; simulation collision skips empty slots.
    assert any(c == 0 and r == TOWER_ROWS-1 and cx == x and cy == y
               for r,c,cx,cy in tower_blocks(s,"p1"))

def test_old_state_fallback_and_ai():
    s = new_state({}, {})
    s.pop("tower_max_hp")
    s.pop("tower_x")
    assert tower_hp(s,"p1")["max"] == 432
    a,p,w = ai_choose_shot(s,"p2")
    assert 0 <= a <= 90 and 5 <= p <= 100 and w == "standard"

def test_structural_collapse_expansion_column():
    s = new_state({"extra_cubes": 6}, {})
    tw=s["towers"]["p1"]
    tw[-1][0]=0
    events=[]
    _explode(s,-500,-500,1,1,"p2",events)
    assert all(row[0] == 0 for row in tw)
    assert any(e["type"]=="collapse" for e in events)

if __name__ == "__main__":
    for f in (test_expansion_counts_and_hp,test_partial_strip_is_wider_and_collidable,
              test_old_state_fallback_and_ai,test_structural_collapse_expansion_column):
        f(); print("PASS",f.__name__)
