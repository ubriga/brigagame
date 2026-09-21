// Lightweight, persistent whole-app language layer. It also translates DOM
// added later by game/store/admin views, so one user choice covers every route.
const Lang = {
  current: localStorage.getItem("brigagame_lang") === "en" ? "en" : "he",
  exact: new Map(Object.entries({
    "לובי":"Lobby","חנות":"Shop","ההתאמה שלי":"My collection","דירוג":"Leaderboard","הודעות":"Messages","ניהול":"Admin",
    "התקנה":"Install","התנתקות":"Sign out","השתקה":"Mute","מתחבר מחדש...":"Reconnecting...","בקרוב":"Coming soon",
    "משחקים":"Matches","משתמשים":"Users","קוסמטיקה":"Cosmetics","קופונים":"Coupons","תחזוקה":"Maintenance",
    "סטטיסטיקות":"Statistics","יומן פעילות":"Activity log","שידור הודעה":"Broadcast","רגיל":"Common","נדיר":"Rare","אפי":"Epic","אגדי":"Legendary",
    "קנה":"Buy","קנה והחל":"Buy & equip","החל מראה":"Equip","לא זמין":"Unavailable","מקסימום":"Maximum","✓ במשחק":"✓ Equipped",
    "יציאה מהמשחק":"Exit match","ביטול":"Cancel","זווית":"Angle","עוצמה":"Power","הזזה":"Move","מגן":"Shield","מגה":"Mega",
    "ללא רוח":"No wind","החטאה!":"Miss!","ניצחת!":"You won!","הפסדת":"You lost","תיקו":"Draw","עוד משחק":"Play again","חזרה ללובי":"Back to lobby",
    "קל - תרגול, ללא נקודות או מטבעות":"Easy - practice, no points or coins","בינוני":"Medium","קשה":"Hard","אולטרה קשה":"Ultra hard","מומחה - האתגר הקשה ביותר":"Expert - ultimate challenge",
    "זכור אותי":"Remember me","כניסה":"Sign in","לא עכשיו":"Not now","העתק קוד":"Copy code","שתף את הקוד עם חבר":"Share the code with a friend",
    "שמור":"Save","זמין":"Available","מחיר":"Price","פריט":"Item","דרגה":"Tier","שגיאה":"Error","נשמר":"Saved","מחק":"Delete",
    "מדיניות פרטיות":"Privacy policy","תנאי שימוש והבהרה":"Terms and disclaimer","אין הודעות עדיין.":"No messages yet.",
    "ברירת מחדל":"Default","המגדל הכחול הקלאסי":"Classic blue tower","משחק חדש - בחר רמת קושי בלבד":"New game - choose difficulty",
    "מגדל היריב הושמד!":"Enemy tower destroyed!","המגדל שלך הושמד.":"Your tower was destroyed.","המשחק בוטל":"Match cancelled",
    "הפעולה אינה זמינה":"Action unavailable","הקנייה נכשלה":"Purchase failed","נקנה בהצלחה!":"Purchased!","שגיאה בטעינת החנות":"Could not load shop",
    "שליטת קטלוג קוסמטי":"Cosmetic catalog controls","מחיר וזמינות נשמרים בשרת.":"Price and availability are saved on the server."
  })),
  words: [[/משחק/g,"game"],[/מטבעות/g,"coins"],[/מראה/g,"cosmetic"],[/מגדל/g,"tower"],[/ניצחון/g,"win"],[/הפסד/g,"loss"],[/רמה/g,"tier"],[/קוד/g,"code"],[/חבר/g,"friend"],[/שחקן/g,"player"],[/טעינה/g,"loading"],[/שגיאה/g,"error"],[/נזק/g,"damage"],[/רוח/g,"wind"]],
  text(value) {
    if (this.current !== "en" || !value || !/[א-ת]/.test(value)) return value;
    const trim=value.trim(), direct=this.exact.get(trim);
    if (direct) return value.replace(trim,direct);
    let out=value;
    for (const [he,en] of this.exact) if (he.length > 5) out=out.split(he).join(en);
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
