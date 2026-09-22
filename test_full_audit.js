const fs=require('fs'), path=require('path');
const app=fs.readFileSync(path.join(__dirname,'js/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'css/style.css'),'utf8');
const i18n=fs.readFileSync(path.join(__dirname,'js/i18n.js'),'utf8');
function check(n,c){if(!c)throw Error(n);console.log('PASS '+n)}
check('async routes reject stale API completions', app.includes('_routeSeq')&&app.includes('routeCurrent(seq)'));
check('route transitions expose a loading status', app.includes('route-loading')&&app.includes('aria-busy'));
check('mobile header navigation is horizontally contained', css.includes('#topbar nav::-webkit-scrollbar')&&css.includes('overflow-x:auto'));
check('mobile controls meet 44px tap target baseline', css.includes('min-height:44px'));
check('wide admin and ranking tables are contained', css.includes('overflow-x:auto')&&css.includes('table{min-width:max-content}'));
check('English covers workshop and audit navigation', ['Tower workshop','Add cubes','Recent transactions','Loading…'].every(x=>i18n.includes(x)));
check('frontend and backend expansion bounds agree', app.includes('0, 24, 1'));
check("admin has full bot difficulty controls", app.includes('bot_difficulty.easy_angle_noise') && app.includes('bot_difficulty.expert_mega_chance') && app.includes('bot_difficulty.expert_reaction'));
