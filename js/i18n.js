// Lightweight, persistent whole-app language layer. It also translates DOM
// added later by game/store/admin views, so one user choice covers every route.
const Lang = {
  current: localStorage.getItem("brigagame_lang") === "en" ? "en" : "he",
  exact: new Map(Object.entries({
    "לובי":"Lobby","חנות":"Shop","ההתאמה שלי":"My collection","דירוג":"Leaderboard","הודעות":"Messages","ניהול":"Admin",
    "התקנה":"Install","התנתקות":"Sign out","השתקה":"Mute","מתחבר מחדש...":"Reconnecting...","בקרוב":"Coming soon",
    "משחקים":"Matches","משתמשים":"Users","שליטת משחק":"Game controls","קוסמטיקה":"Cosmetics","קופונים":"Coupons","תחזוקה":"Maintenance",
    "סטטיסטיקות":"Statistics","יומן פעילות":"Activity log","שידור הודעה":"Broadcast","רגיל":"Common","נדיר":"Rare","אפי":"Epic","אגדי":"Legendary",
    "קנה":"Buy","קנה והחל":"Buy & equip","החל מראה":"Equip","לא זמין":"Unavailable","מקסימום":"Maximum","✓ במשחק":"✓ Equipped",
    "יציאה מהמשחק":"Exit match","לצאת מהמשחק?":"Exit the match?","ביטול":"Cancel","זווית":"Angle","עוצמה":"Power","הזזה":"Move","מגן":"Shield","מגה":"Mega",
    "ללא רוח":"No wind","החטאה!":"Miss!","ניצחת!":"You won!","הפסדת":"You lost","תיקו":"Draw","עוד משחק":"Play again","חזרה ללובי":"Back to lobby",
    "קל - תרגול, ללא נקודות או מטבעות":"Easy - practice, no points or coins","בינוני":"Medium","קשה":"Hard","אולטרה קשה":"Ultra hard","מומחה - האתגר הקשה ביותר":"Expert - ultimate challenge",
    "זכור אותי":"Remember me","כניסה":"Sign in","לא עכשיו":"Not now","העתק קוד":"Copy code","שתף את הקוד עם חבר":"Share the code with a friend",
    "שמור":"Save","זמין":"Available","מחיר":"Price","פריט":"Item","דרגה":"Tier","שגיאה":"Error","נשמר":"Saved","מחק":"Delete",
    "מדיניות פרטיות":"Privacy policy","תנאי שימוש והבהרה":"Terms and disclaimer","אין הודעות עדיין.":"No messages yet.",
    "ברירת מחדל":"Default","המגדל הכחול הקלאסי":"Classic blue tower","משחק חדש - בחר רמת קושי בלבד":"New game - choose difficulty",
    "מגדל היריב הושמד!":"Enemy tower destroyed!","המגדל שלך הושמד.":"Your tower was destroyed.","המשחק בוטל":"Match cancelled",
    "הפעולה אינה זמינה":"Action unavailable","הקנייה נכשלה":"Purchase failed","נקנה בהצלחה!":"Purchased!","שגיאה בטעינת החנות":"Could not load shop",
    "שליטת קטלוג קוסמטי":"Cosmetic catalog controls","מחיר וזמינות נשמרים בשרת.":"Price and availability are saved on the server.",
    "קצב התקדמות XP":"XP progression rate","בונוס ניצחון מול שחקן":"Player win bonus","בונוס ניצחון מול מחשב":"Bot win bonus","XP לכל נקודת נזק":"XP per damage point","סקינים מושקעים":"Premium skins","תקציב משקל לסקין (KB)":"Asset budget per skin (KB)","ציפויי מגדל":"Tower coatings","מספר שלבים מרבי":"Maximum levels","זמן בנייה בסיסי (דקות)":"Base build time (minutes)","הרחבת מגדל":"Tower expansion","מספר קוביות נוספות מרבי":"Maximum extra cubes","מכשול דינמי":"Dynamic obstacle","מהירות":"Speed","התראה לפני תנועה (שניות)":"Warning before movement (seconds)","מופעל":"Enabled","שליטה מלאה ברמות הבוט":"Full bot difficulty control","קל":"Easy","סטיית זווית מרבית (°)":"Maximum angle deviation (°)","סטיית עוצמה (0-0.5)":"Power spread (0-0.5)","פיצוי רוח (0-1)":"Wind compensation (0-1)","זמן תגובה (שניות)":"Reaction time (seconds)","תוספת דרגות מעל השחקן":"Rank levels above player","סיכוי להשתמש במגן (0-1)":"Shield chance (0-1)","סיכוי להשתמש במגה (0-1)":"Mega chance (0-1)","שמור את כל ההגדרות":"Save all settings","הגדרות המשחק נשמרו":"Game settings saved","ערך לא תקין - לא נשמר":"Invalid value - not saved",
    "שלום,":"Hello,","הפל את מגדל היריב לפני שהוא מפיל את שלך.":"Destroy the enemy tower before it destroys yours.","🎮 משחק":"🎮 Play",
    "⚡ משחק מהיר":"⚡ Quick match","🤖 משחק מול בוט":"🤖 Play vs bot","🔗 משחק חברים (צור קוד)":"🔗 Friend match (create code)","הצטרף":"Join",
    "רמת קושי":"Difficulty","קוד משחק":"Match code","📊 הסטטיסטיקה שלך":"📊 Your statistics","דרגה נוכחית:":"Current rank:","הבאה:":"Next:",
    "דירוג":"Rating","נצחונות":"Wins","הפסדים":"Losses","🎁 בונוס יומי (נאסף)":"🎁 Daily bonus (collected)","🎁 בונוס יומי":"🎁 Daily bonus",
    "משחק חינמי, ללא פרסים או ערך כספי":"Free game, no prizes or monetary value","הצג הודעת תחזוקה":"Show maintenance notice",
    "להתקין את Brigagame?":"Install Brigagame?","גישה מהירה ומסך מלא לרוחב":"Quick access and full-screen landscape mode",
    "🛒 חנות":"🛒 Shop","יתרה:":"Balance:","🎟️ מימוש קופון":"🎟️ Redeem coupon","קוד קופון":"Coupon code","ממש":"Redeem",
    "⚔️ נשקים מיוחדים":"⚔️ Special weapons","🛡️ שדרוגי מגדל":"🛡️ Tower upgrades","🎨 מראה":"🎨 Cosmetics","בתיק:":"Inventory:","שימושים":"uses",
    "בבעלותך - לחץ להחיל":"Owned - click to equip","✓ המראה הפעיל שלך":"✓ Your active cosmetic","נקנה והוחל! יופיע במשחק הבא":"Purchased and equipped! It will appear next match",
    "המראה הוחל - יופיע במשחק הבא":"Cosmetic equipped - it will appear next match","🛠️ ניהול":"🛠️ Admin","פעילים היום":"Active today",
    "משחקים פעילים":"Active matches","מטבעות הונפקו":"Coins issued","מטבעות הוצאו":"Coins spent","רכישות":"Purchases","חסומים":"Blocked",
    "🎯 משחק תרגול - לא נספר לדרגה":"🎯 Practice match - does not affect rank","גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז ומשתנה אחרי כל ירייה, ובכל משחק המגדלים במיקומים אחרים.":"Drag from your tower to aim and release to fire. Wind moves the shell and changes after every shot; tower positions vary each match.",
    "⌨️ מקלדת:":"⌨️ Keyboard:","ירייה":"fire","בחירת נשק":"choose weapon","יוצא...":"Exiting...","יציאה ממשחק פעיל תיספר כהפסד בדירוג":"Leaving an active match counts as a ranked loss","יציאה ממשחק תרגול לא תשפיע על הדירוג":"Leaving a practice match does not affect rank",
    "פגיעה קריטית בקנה התותח!":"Critical cannon hit!","משב רוח קיצוני":"Extreme wind gust","מטאור פגע בזירה":"A meteor hit the arena","מטען מגה נוסף":"Extra mega charge",
    "מוות פתאומי - הנזק הוכפל!":"Sudden death - damage doubled!","הזמן נגמר - לשני המגדלים אותה שלמות.":"Time is up - both towers have equal integrity.",
    "משחק תרגול - לא נספר לדרגה":"Practice match - does not affect rank","המשחק הסתיים מסיבה טכנית - ללא ניצחון, הפסד או מטבעות.":"The match ended for a technical reason - no win, loss, or coins.",
    "ריבאנץ' נגד OrelAI Bot":"Rematch against OrelAI Bot","יוצר משחק...":"Creating match...","שגיאה ביצירת משחק":"Could not create match",
    "הדירוג עולה ויורד לפי נצחונות והפסדים.":"Rating rises and falls with wins and losses.","טבלת דירוג":"Leaderboard","שחקן":"Player","הפ׳":"L","נצ׳":"W",
    "טוראי":"Private","רב טוראי":"Private First Class","סמל":"Sergeant","סמל ראשון":"Staff Sergeant","רב סמל":"Sergeant First Class","רב סמל ראשון":"Master Sergeant","רב סמל מתקדם":"Advanced Master Sergeant","רב סמל בכיר":"Senior Master Sergeant","רב נגד":"Chief Warrant Officer","סגן משנה":"Second Lieutenant","סגן":"Lieutenant","סרן":"Captain","רב סרן":"Major","סגן אלוף":"Lieutenant Colonel","אלוף משנה":"Colonel","תת אלוף":"Brigadier General","אלוף":"Major General","רב אלוף":"Lieutenant General",
    "נשארו":"Remaining:","לקידום":"to promotion","מטבעות":"Coins","יתרה:":"Balance:","בתיק:":"Inventory:","שימושים":"uses","חבילה של":"pack of",
    "פצצה כפולה":"Double Bomb","טיל מסתובב":"Homing Missile","פגז מרושת":"Cluster Shell","שריון":"Armor Plating","חיזוק מגדל":"Reinforced Tower",
    "משגרת שני פגזים ברצף בכל ירייה. חבילה של 3 שימושים.":"Fires two shells in sequence. Pack of 3 uses.","מתקן את מסלולו לעבר מגדל האויב באוויר. חבילה של 3 שימושים.":"Corrects its path toward the enemy tower. Pack of 3 uses.","מתפצל לארבעה פצצונים בשיא המסלול. חבילה של 3 שימושים.":"Splits into four bomblets at the trajectory peak. Pack of 3 uses.","מפחית נזק נכנס ב-4% לרמה.":"Reduces incoming damage by 4% per level.","מגדיל את חיי המגדל ב-10% לרמה.":"Increases tower health by 10% per level.",
    "מימוש קופון":"Redeem coupon","נשקים מיוחדים":"Special weapons","שדרוגי מגדל":"Tower upgrades","מראה":"Cosmetics","כל רכישה מופיעה כאן מיד.":"Every purchase appears here immediately.",
    "התקנת המשחק":"Install game","השתקה":"Mute","סגירת הודעת תחזוקה":"Close maintenance notice","תחזוקה":"Maintenance","אין חיבור לשרת":"No server connection","נסה שוב":"Try again",
    "גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות.":"Drag from your tower to aim and release to fire.","רווח":"Space","צעדים גדולים":"large steps","רגיל (∞)":"Standard (∞)","כפולה":"Double","מסתובב":"Homing","מרושת":"Cluster",
    "הזמן נגמר":"Time is up","למגדל שלך נשארה יותר שלמות.":"Your tower has more integrity remaining.","למגדל היריב נשארה יותר שלמות.":"The enemy tower has more integrity remaining.","דירוג ":"Rating ","קודמת לדרגת":"Promoted to",
    "מחכים ליריב...":"Waiting for opponent...","משחק מהיר - מחפש יריב":"Quick match - finding an opponent","להיכנס למשחק?":"Enter the match?","כן, מתחילים":"Yes, start","דחית את ההזמנה":"You declined the invitation","ההזמנה פגה":"The invitation expired",
    "סדנת המגדל":"Tower workshop","סדנת המגדל שלי":"My tower workshop","כאן משדרגים את המגדל. ציפויים וקוביות נמצאים תמיד בראש העמוד.":"Upgrade your tower here. Coatings and expansion cubes are always at the top.",
    "ציפוי מגדל":"Tower coating","הוספת קוביות":"Add cubes","מראה המגדל":"Tower appearance","בניית ציפוי למגדל שלי":"Build tower coating","הרחבת שטח המגדל":"Expand tower footprint",
    "נשקים":"Weapons","שדרוגים":"Upgrades","מראות":"Cosmetics","הכל":"All","מחפש ציפוי או קוביות למגדל?":"Looking for coatings or tower cubes?","הם נמצאים בסדנת המגדל, יחד עם הפועלים וזמני הבנייה.":"Find them in the tower workshop with builders and build times.","לסדנת המגדל":"Open tower workshop",
    "תנועות אחרונות":"Recent transactions","ציפויים":"Coatings","אין ציפוי פעיל":"No active coating","אין בנייה פעילה.":"No active build.","התחל בנייה":"Start build","הושלם":"Complete","נעול":"Locked","בתור":"Queued","בבנייה":"Building",
    "טוען…":"Loading…","משחקים פעילים":"Active matches","מטבעות הונפקו":"Coins issued","מטבעות הוצאו":"Coins spent","חסומים":"Blocked"
  })),
  words: [],
  text(value) {
    if (this.current !== "en" || !value || !/[א-ת]/.test(value)) return value;
    const trim=value.trim(), direct=this.exact.get(trim);
    if (direct) return value.replace(trim,direct);
    let out=value;
    // Phrase replacement is safe because every source is an explicit UI string,
    // never a loose fragment. It also translates values embedded with numbers.
    for (const [he,en] of [...this.exact].sort((a,b)=>b[0].length-a[0].length)) out=out.split(he).join(en);
    for (const [re,en] of this.words) out=out.replace(re,en);
    return out;
  },
  apply(root=document) {
    document.documentElement.lang=this.current;
    document.documentElement.dir=this.current === "en" ? "ltr" : "rtl";
    if (this.current !== "en") return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n=>{ if(!['SCRIPT','STYLE'].includes(n.parentElement?.tagName)) n.nodeValue=this.text(n.nodeValue); });
    root.querySelectorAll?.('[title],[aria-label],[placeholder]').forEach(el=>['title','aria-label','placeholder'].forEach(a=>{if(el.hasAttribute(a))el.setAttribute(a,this.text(el.getAttribute(a)))}));
  },
  set(lang) { localStorage.setItem("brigagame_lang",lang); location.reload(); },
  boot() {
    this.apply();
    new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)this.apply(n);else if(n.nodeType===3)n.nodeValue=this.text(n.nodeValue)}))).observe(document.body,{subtree:true,childList:true});
    const b=document.getElementById('lang-btn'); if(b){b.textContent=this.current==='en'?'עברית':'EN';b.onclick=()=>this.set(this.current==='en'?'he':'en');}
  },
  pick(item,key='name'){ return this.current==='en' ? (item[key] || item.name) : (item[key+'_he'] || item[key] || item.name); }
};
