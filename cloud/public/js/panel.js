// Loaded on demand, only after the server confirms elevated access for the
// signed-in account. Registers the management route, nav entry, translations
// and styles. Nothing here ships inside the regular client bundle.
const PANEL_CSS = `
#admin-body .card{max-width:100%;overflow-x:auto}
.tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.tabs button { background: var(--panel2); color: var(--muted); border: none; padding: 8px 14px; border-radius: 10px; cursor: pointer; }
.tabs button.active { background: var(--accent); color: #0b1120; font-weight: 700; }
.stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.stat-cards .card { text-align: center; padding: 12px; }
.stat-cards b { font-size: 22px; display: block; color: var(--accent); }
.bot-admin { display: grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 14px; }
.bot-admin > h2, .bot-admin > p { grid-column: 1 / -1; }
`;

const PANEL_STRINGS = {
  "ניהול":"Admin",
  "🛠️ ניהול":"🛠️ Admin",
  "סטטיסטיקות":"Statistics",
  "משתמשים":"Users",
  "שליטת משחק":"Game controls",
  "יומן פעילות":"Activity log",
  "שידור הודעה":"Broadcast",
  "שליטת קטלוג קוסמטי":"Cosmetic catalog controls",
  "מחיר וזמינות נשמרים בשרת.":"Price and availability are saved on the server.",
  "קצב התקדמות XP":"XP progression rate",
  "בונוס ניצחון מול שחקן":"Player win bonus",
  "בונוס ניצחון מול מחשב":"Bot win bonus",
  "XP לכל נקודת נזק":"XP per damage point",
  "סקינים מושקעים":"Premium skins",
  "תקציב משקל לסקין (KB)":"Asset budget per skin (KB)",
  "ציפויי מגדל":"Tower coatings",
  "מספר שלבים מרבי":"Maximum levels",
  "זמן בנייה בסיסי (דקות)":"Base build time (minutes)",
  "הרחבת מגדל":"Tower expansion",
  "מספר קוביות נוספות מרבי":"Maximum extra cubes",
  "מכשול דינמי":"Dynamic obstacle",
  "מהירות":"Speed",
  "התראה לפני תנועה (שניות)":"Warning before movement (seconds)",
  "מופעל":"Enabled",
  "שליטה מלאה ברמות הבוט":"Full bot difficulty control",
  "פחות סטייה, יותר פיצוי רוח וזמן תגובה קצר יותר מחזקים את הבוט. הערכים נשמרים בשרת וחלים על משחקי בוט חדשים.":"Lower deviation, stronger wind compensation, and faster reactions make the bot stronger. Values are saved on the server and apply to new bot matches.",
  "ערכי ברירת המחדל החדשים מאטים את ההתקדמות בערך פי 5. שינוי חל רק על משחקים שיסתיימו מעכשיו.":"The current defaults slow progression by about 5x. Changes apply only to matches completed from now on.",
  "קל":"Easy",
  "סטיית זווית מרבית (°)":"Maximum angle deviation (°)",
  "סטיית עוצמה (0-0.5)":"Power spread (0-0.5)",
  "פיצוי רוח (0-1)":"Wind compensation (0-1)",
  "זמן תגובה (שניות)":"Reaction time (seconds)",
  "תוספת דרגות מעל השחקן":"Rank levels above player",
  "סיכוי להשתמש במגן (0-1)":"Shield chance (0-1)",
  "סיכוי להשתמש במגה (0-1)":"Mega chance (0-1)",
  "שמור את כל ההגדרות":"Save all settings",
  "הגדרות המשחק נשמרו":"Game settings saved",
  "ערך לא תקין - לא נשמר":"Invalid value - not saved",
  "פעילים היום":"Active today",
  "משחקים פעילים":"Active matches",
  "מטבעות הונפקו":"Coins issued",
  "מטבעות הוצאו":"Coins spent",
  "רכישות":"Purchases",
  "חסומים":"Blocked"
};

async function vAdmin(App, view, tab, seq = App._routeSeq) {
  if (!App.routeCurrent(seq)) return;
  if (!App.me?.is_admin) { view.innerHTML = "<p>אין הרשאה.</p>"; return; }
  clearInterval(App._onlineTimer); App._onlineTimer = null;
  tab = tab || "stats";
  view.removeAttribute("aria-busy");
  view.innerHTML = `
    <h1>🛠️ ניהול</h1>
    <div class="tabs">
      ${["stats", "users", "gameplay", "coatings", "cosmetics", "audit", "broadcast", "coupons", "matches", "maintenance"].map(t =>
        `<button data-tab="${t}" class="${t === tab ? "active" : ""}">${{
          stats: "סטטיסטיקות", users: "משתמשים", gameplay: "שליטת משחק", coatings: "ציפויים", cosmetics: "קוסמטיקה", audit: "יומן פעילות", broadcast: "שידור הודעה",
          coupons: "קופונים", matches: "משחקים", maintenance: "תחזוקה" }[t]}</button>`).join("")}
    </div>
    <div id="admin-body"></div>`;
  view.querySelectorAll(".tabs button").forEach(b =>
    b.onclick = () => vAdmin(App, view, b.dataset.tab));
  const body = document.getElementById("admin-body");

  if (tab === "stats") {
    const { status: overviewStatus, data } = await API.get("/api/admin/overview");
    if (overviewStatus !== 200 || !data || !data.stats) {
      body.innerHTML = `<div class="card"><h2>לא ניתן לטעון סטטיסטיקות</h2><p class="sub">${esc(data?.error_he || "בדוק את החיבור ונסה שוב.")}</p><button class="btn small" id="stats-retry">נסה שוב</button></div>`;
      document.getElementById("stats-retry").onclick = () => vAdmin(App, view, "stats");
      return;
    }
    const s = data.stats;
    body.innerHTML = `<div class="stat-cards">
      ${[["משתמשים", s.users_total], ["פעילים היום", s.users_today],
         ["משחקים", s.matches_total], ["משחקים פעילים", s.matches_active],
         ["מטבעות הונפקו", s.coins_issued], ["מטבעות הוצאו", s.coins_spent],
         ["רכישות", s.purchases], ["חסומים", s.banned]]
        .map(([k, v]) => `<div class="card"><b>${v ?? 0}</b>${k}</div>`).join("")}
      </div><h2>תנועות אחרונות</h2><div class="card"><table>
      <tr><th>זמן</th><th>משתמש</th><th>סכום</th><th>סיבה</th></tr>
      ${(data.recent_transactions || []).map(t =>
        `<tr><td>${esc(t.created_at.slice(5, 16).replace("T", " "))}</td>
         <td>${esc(t.email)}</td><td>${t.delta}</td><td>${esc(t.reason)}</td></tr>`).join("")}
      </table></div>`;
  } else if (tab === "users") {
    body.innerHTML = `<div id="online-box"></div>
      <input id="uq" placeholder="חיפוש לפי שם או אימייל">
      <div id="ulist" style="margin-top:10px"></div>`;
    const loadOnline = async () => {
      const box = document.getElementById("online-box");
      if (!box) return;  // navigated away from the tab
      const { status, data } = await API.get("/api/admin/online");
      if (status !== 200 || !data) return;
      const names = (data.users || []).map(u => esc(u.name || u.email));
      box.innerHTML = `<div class="card" style="margin-bottom:12px">
        <b>🟢 מחוברים כעת: ${data.count}</b>
        <div class="sub" style="margin-top:6px">${names.join(" · ") || "אין משתמשים מחוברים כרגע"}</div>
      </div>`;
    };
    loadOnline();
    App._onlineTimer = setInterval(loadOnline, 10000);
    const load = async () => {
      const { data } = await API.get("/api/admin/users?q=" + encodeURIComponent(document.getElementById("uq").value));
      document.getElementById("ulist").innerHTML = `<div class="card"><table>
        <tr><th>משתמש</th><th>מטבעות</th><th>דירוג</th><th>נ/ה</th><th>סטטוס</th><th>פעולות</th></tr>
        ${(data.users || []).map(u => `<tr>
          <td>${esc(u.name)}<br><span class="sub" style="margin:0">${esc(u.email)}</span></td>
          <td>${u.coins}</td><td>${u.rating}</td><td>${u.wins}/${u.losses}</td>
          <td>${u.suspended ? "🚫 מושהה" : u.banned_until ? "⏸️ חסום" : "✓"}</td>
          <td style="white-space:nowrap">
            <button class="btn small secondary" data-coins="${u.id}">🪙±</button>
            <button class="btn small secondary" data-ban="${u.id}">חסום 24ש׳</button>
            <button class="btn small secondary" data-susp="${u.id}">השהה</button>
            <button class="btn small secondary" data-lift="${u.id}">שחרר</button>
          </td></tr>`).join("")}</table></div>`;
      body.querySelectorAll("[data-ban]").forEach(b => b.onclick = async () => {
        await API.post(`/api/admin/users/${b.dataset.ban}/moderate`, { action: "ban", hours: 24 });
        toast("נחסם ל-24 שעות"); load();
      });
      body.querySelectorAll("[data-susp]").forEach(b => b.onclick = async () => {
        await API.post(`/api/admin/users/${b.dataset.susp}/moderate`, { action: "suspend" });
        toast("הושהה"); load();
      });
      body.querySelectorAll("[data-lift]").forEach(b => b.onclick = async () => {
        await API.post(`/api/admin/users/${b.dataset.lift}/moderate`, { action: "lift" });
        toast("שוחרר"); load();
      });
      body.querySelectorAll("[data-coins]").forEach(b => b.onclick = async () => {
        const v = prompt("כמה מטבעות להוסיף/להוריד? (למשל 500 או -200)");
        if (v === null) return;
        const reason = prompt("סיבה (תוצג ביומן):", "admin_adjustment") || "admin_adjustment";
        const { data: d } = await API.post(`/api/admin/users/${b.dataset.coins}/coins`,
          { delta: parseInt(v, 10) || 0, reason });
        if (d.ok) { toast("עודכן. יתרה: " + d.coins); load(); }
        else toast("שגיאה");
      });
    };
    document.getElementById("uq").oninput = () => load();
    load();
  } else if (tab === "gameplay") {
    const { status, data } = await API.get("/api/admin/gameplay-controls");
    if (status !== 200) { body.innerHTML = "<p>שגיאה בטעינת השליטה במשחק.</p>"; return; }
    const c = data.controls;
    const feature = (key, title, fields, hint) => `<div class="card"><h2>${title}</h2>
      ${hint ? `<p class="sub">${hint}</p>` : ""}
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="${key}.enabled" ${c[key].enabled ? "checked" : ""} style="width:auto">מופעל</label>
      ${fields.map(([field, label, min, max, step]) => `<label>${label}</label><input type="number" min="${min}" max="${max}" step="${step}" value="${c[key][field]}" data-control="${key}.${field}">`).join("")}</div>`;
    body.innerHTML = `<div class="card"><h2>קצב התקדמות XP</h2><p class="sub">ערכי ברירת המחדל החדשים מאטים את ההתקדמות בערך פי 5. שינוי חל רק על משחקים שיסתיימו מעכשיו. בונוס ניצחון = נקודות XP שמתווספות לדירוג הצבאי; XP לכל נזק = כמה XP מקבלים על כל נקודת נזק שגורמים במשחק.</p>
        <label>בונוס ניצחון מול שחקן</label><input type="number" min="0" max="100" step="0.1" value="${c.xp.human_win}" data-control="xp.human_win">
        <label>בונוס ניצחון מול מחשב</label><input type="number" min="0" max="100" step="0.1" value="${c.xp.bot_win}" data-control="xp.bot_win">
        <label>XP לכל נקודת נזק</label><input type="number" min="0" max="1" step="0.001" value="${c.xp.per_damage}" data-control="xp.per_damage"></div>
      <div class="card"><h2>🔐 דרכי התחברות</h2><p class="sub">שליטה בדרכי ההתחברות שמוצגות בשער הכניסה. כפתור גוגל = החלון הקטן של גוגל. כניסה עם חשבון גוגל = כניסה דרך דף גוגל הרגיל (עובדת גם בדפדפנים שחוסמים חלונות). קוד למייל = כניסה בלי גוגל בכלל, עם קוד שנשלח למייל (דורש חיבור שירות מייל בשרת).</p>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="auth_flow.popup_enabled" ${c.auth_flow.popup_enabled ? "checked" : ""} style="width:auto">כפתור גוגל (חלון קטן)</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="auth_flow.redirect_enabled" ${c.auth_flow.redirect_enabled ? "checked" : ""} style="width:auto">כניסה עם חשבון גוגל (דף מלא)</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="auth_flow.email_code_enabled" ${c.auth_flow.email_code_enabled ? "checked" : ""} style="width:auto">כניסה עם קוד למייל</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="auth_flow.pwa_email_hint" ${c.auth_flow.pwa_email_hint !== false ? "checked" : ""} style="width:auto">הסבר PWA: הדגשת קוד מייל באפליקציה המותקנתת</label>
        <label>שירות המייל לשליחת קודים</label><select data-control="auth_flow.email_provider">${[["inboxlv", "inbox.lv (חינם, עד כ-15 מיילים לשעה)"], ["resend", "Resend (דורש דומיין משלנו - כרגע לא פעיל)"]].map(([v, l]) => `<option value="${v}" ${c.auth_flow.email_provider === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <div class="sub" style="font-size:12px">סיסמת תוכנת הדואר מנוהלת בכספת המערכת, לא כאן.</div></div>
      <div class="card"><h2>📨 הזמנת חבר (א1)</h2><p class="sub">כפתור "הזמן חבר" בלובי ובסיום משחק מייצר קישור אישי. כשהחבר נכנס דרך הקישור (נרשם או מתחבר), המזמין מקבל תג באופן אוטומטי והתג מוצג בעמוד התגים. מכסה יומית = כמה הזמנות כל שחקן יכול ליצור ביום. שם התג = התג שהמזמין מקבל. נוסח ההזמנה = הטקסט שמחוך לקישור בשיתוף; {name} מוחלף בשם המזמין.</p>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="invite_system.enabled" ${c.invite_system && c.invite_system.enabled ? "checked" : ""} style="width:auto">מערכת ההזמנות פעילה</label>
        <label>מכסת הזמנות ליום</label><input type="number" min="1" max="100" step="1" value="${c.invite_system ? c.invite_system.max_per_day : 5}" data-control="invite_system.max_per_day">
        <label>שם התג למזמין</label><input type="text" maxlength="40" value="${esc(c.invite_system ? c.invite_system.tag_name : "מגייס")}" data-control="invite_system.tag_name">
        <label>נוסח הודעת ההזמנה</label><input type="text" maxlength="300" value="${esc(c.invite_system ? c.invite_system.invite_text : "")}" data-control="invite_system.invite_text"></div>
      <div class="card"><h2>🤖 הצעת מעבר למשחק נגד בוט</h2><p class="sub">במשחק מהיר, אם לא נמצא יריב אנושי תוך הזמן הזה, השחקן מקבל הצעה לעבור למשחק מיידי נגד הבוט. רמת הבוט = עוצמת הבוט במשחק הגיבוי (קל = משחק אימון בלי נקודות דירוג; בינוני ומעלה = משחק מדורג). בכיבוי - ההצעה לא מוצגת והחיפוש אחר יריב ממשיך כרגיל.</p>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="bot_fallback.enabled" ${c.bot_fallback.enabled ? "checked" : ""} style="width:auto">מופעל</label>
        <label>זמן המתנה לפני הצגת ההצעה (שניות)</label><input type="number" min="5" max="300" step="1" value="${c.bot_fallback.wait_seconds}" data-control="bot_fallback.wait_seconds">
        <label>רמת הבוט בגיבוי</label><select data-control="bot_fallback.difficulty">${[["easy", "קל (אימון)"], ["medium", "בינוני"], ["hard", "קשה"], ["ultra", "אולטרה קשה"], ["expert", "מומחה"]].map(([v, l]) => `<option value="${v}" ${c.bot_fallback.difficulty === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      ${feature("premium_skins", "סקינים מושקעים", [["asset_budget_kb", "תקציב משקל לסקין (KB)", 10, 500, 1]], "תקציב משקל = הגודל המרבי (ב-KB) של קובץ סקין שמותר להעלות. גבוה יותר = קבצים כבדים יותר שנטענים לאט יותר.")}
      ${feature("coatings", "ציפויי מגדל", [["max_level", "מספר שלבים מרבי", 1, 3, 1], ["wood_price", "מחיר עץ", 0, 100000, 1], ["wood_minutes", "זמן עץ (דקות)", .01, 10080, .01], ["wood_hp", "הגנת עץ", 1, 10000, 1], ["tin_price", "מחיר פח", 0, 100000, 1], ["tin_minutes", "זמן פח (דקות)", .01, 10080, .01], ["tin_hp", "הגנת פח", 1, 10000, 1], ["iron_price", "מחיר ברזל", 0, 100000, 1], ["iron_minutes", "זמן ברזל (דקות)", .01, 10080, .01], ["iron_hp", "הגנת ברזל", 1, 10000, 1]], "מחיר = עלות במטבעות. זמן = משך הבנייה בדקות. הגנה = כמה HP הציפוי סופג לפני שהמגדל נפגע. מספר שלבים = כמה רמות ציפוי אפשר לבנות ברצף (עץ ← פח ← ברזל).")}
      ${feature("tower_expansion", "הרחבת מגדל", [["max_extra_cubes", "מספר קוביות נוספות מרבי", 0, 24, 1], ["build_minutes", "זמן בנייה בסיסי (דקות)", .01, 10080, .01], ["cube_price", "מחיר קובייה", 0, 100000, 1], ["cube_hp", "חיים לכל קובייה", 1, 10000, 1]], "קוביות נוספות = כמה קוביות אפשר להוסיף למגדל מעל הבסיס. זמן בנייה = דקות לכל קובייה (עולה עם כל קובייה). מחיר = עלות כל קובייה במטבעות. חיים = HP שכל קובייה מוסיפה למגדל.")}
      ${feature("dynamic_obstacle", "מכשול דינמי", [["speed", "מהירות", 1, 200, 1], ["warning_seconds", "התראה לפני תנועה (שניות)", 0, 10, 0.1]], "מהירות = קצב תנועת המכשול בזירה (גבוה = מהיר יותר). התראה = כמה שניות מוצגת אזהרה לשחקנים לפני שהמכשול זז.")}
      <div class="card bot-admin"><h2>🤖 מנוע הבוט החכם</h2><p class="sub">כל שינוי חל על משחקי בוט חדשים בלבד. משחק שכבר התחיל שומר snapshot מלא.</p>
        <details class="sub" style="margin-bottom:8px"><summary>מה מפעיל כל מתג?</summary>
        מנוע חכם = כיבוי/הדלקה כוללת של הבוט החכם (בכיבוי: בוט בסיסי). נשקים מיוחדים = שולט בכולם ביחד או בכל אחד בנפרד. תנועה טקטית = הבוט זז לעמדה טובה יותר. מגן תגובתי = הבוט מפעיל מגן כשהוא בסכנה. Mega טקטי = הבוט שומר Mega לרגע הנכון. הסתגלות = הבוט לומד מהפספוסים שלו בתוך המשחק. תחמושת אינסופית = הבוט לא מוגבל במלאי נשקים מיוחדים.</details>
        <div class="bot-system-toggles">
          ${[["enabled","מנוע חכם"],["special_weapons","נשקים מיוחדים"],["double_bomb","פצצה כפולה"],["homing_missile","טיל מתביית"],["cluster_shell","פגז מצרר"],["movement","תנועה טקטית"],["reactive_shield","מגן תגובתי"],["tactical_mega","Mega טקטי"],["adaptation","הסתגלות בתוך משחק"],["infinite_ammo","תחמושת אינסופית"]].map(([k,l]) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-control="bot_system.${k}" ${c.bot_system[k] ? "checked" : ""} style="width:auto">${l}</label>`).join("")}
        </div></div>
      <div class="card bot-admin"><h2>🎯 כוונון לפי רמה</h2><p class="sub">דיוק, משאבים, הגנה, תנועה, זיכרון ואגרסיביות. הערכים נשמרים בשרת.</p>
        <details class="sub" style="margin-bottom:8px"><summary>מה משמעות כל שדה?</summary>
        סטיית זווית = כמה מעלות הבוט עלול לסטות בירי (גבוה = פחות מדויק). סטיית עוצמה = פיזור בעוצמה (גבוה = פחות עקבי). פיצוי רוח = כמה הבוט מתחשב ברוח (1 = מלא, 0 = מתעלם). זמן תגובה = השהייה בשניות לפני ירי (נמוך = מהיר יותר). תוספת דרגות = כמה דרגות מעל רמת השחקן הבוט משחק. תחמושת = כמה נשקים מיוחדים הבוט מתחיל איתם. מיומנות בחירת נשק = 1 = בחירה אופטימלית. סף HP למגן = מתחת לאחוז חיים הזה הבוט מגן על עצמו. סף נזק תגובתי = נזק שמפעיל תגובת מגן. נטייה לזוז / ל-Mega = סיכוי בתור (0-1). עומק זיכרון = כמה יריות אחורה הבוט לומד. חוזק תיקון = עוצמת התיקון אחרי פספוס. אגרסיביות = 1 = מעדיף התקפה על הגנה.</details>
        ${[["easy","קל"],["medium","בינוני"],["hard","קשה"],["ultra","אולטרה קשה"],["expert","מומחה"]].map(([t,label]) => `<div class="bot-tier-controls"><h3>${label}</h3>
          ${[["angle_noise","סטיית זווית מרבית (°)",0,45,.05],["power_spread","סטיית עוצמה",0,.5,.001],["wind_skill","פיצוי רוח",0,1,.01],["reaction","זמן תגובה",0,10,.05],["rank_offset","תוספת דרגות",0,18,1],["double_ammo","תחמושת כפולה",0,99,1],["homing_ammo","תחמושת מתבייתת",0,99,1],["cluster_ammo","תחמושת מצרר",0,99,1],["weapon_skill","מיומנות בחירת נשק",0,1,.01],["shield_hp","סף HP למגן",0,1,.01],["shield_damage","סף נזק תגובתי",0,1000,1],["move_chance","נטייה לזוז",0,1,.01],["mega_chance","נטייה ל-Mega",0,1,.01],["memory","עומק זיכרון",0,20,1],["correction","חוזק תיקון",0,1,.01],["aggression","אגרסיביות",0,1,.01]].map(([k,l,min,max,step]) => `<label>${l}</label><input type="number" min="${min}" max="${max}" step="${step}" value="${c.bot_difficulty[t+"_"+k]}" data-control="bot_difficulty.${t+"_"+k}">`).join("")}
        </div>`).join("")}</div>
      <button class="btn" id="gameplay-save">שמור את כל ההגדרות</button>
      <button class="btn secondary" id="gameplay-reset">איפוס לברירות מחדל</button>`;
    document.getElementById("gameplay-reset").onclick = async () => {
      if (!confirm("לאפס את כל הגדרות המשחק לברירות המחדל? השינוי יחול על משחקי בוט חדשים.")) return;
      const { status: reset } = await API.post("/api/admin/gameplay-controls", { reset: true });
      if (reset === 200) { toast("ההגדרות אופסו"); vAdmin(App, view, "gameplay"); }
      else toast("האיפוס נכשל");
    };
    document.getElementById("gameplay-save").onclick = async () => {
      const updated = JSON.parse(JSON.stringify(c));
      body.querySelectorAll("[data-control]").forEach(input => {
        const [section, key] = input.dataset.control.split(".");
        updated[section][key] = input.type === "checkbox" ? input.checked
          : (input.tagName === "SELECT" ? input.value
          : (input.type === "password" || input.type === "text" ? input.value : Number(input.value)));
      });
      const { status: saved } = await API.post("/api/admin/gameplay-controls", { controls: updated }, { timeoutMs: 30000 });
      toast(saved === 200 ? "הגדרות המשחק נשמרו" : "ערך לא תקין - לא נשמר");
    };
  } else if (tab === "coatings") {
    const { status, data } = await API.get("/api/coatings");
    if (status !== 200) { body.innerHTML = "<p>שגיאה בטעינת הציפויים.</p>"; return; }
    const active = data.current;
    const order = ["wood", "tin", "iron"];
    const queued = new Set((data.jobs || []).map(j => j.material));
    const activeLevel = active ? order.indexOf(active.material) + 1 : 0;
    const next = order[activeLevel];
    body.innerHTML = `<div class="card"><h2>🏗️ ציפויים בבנייה</h2>
      <p>${active ? `ציפוי פעיל: <b>${esc(data.catalog[active.material].name_he)}</b> (${Math.round(active.hp)}/${Math.round(active.max_hp)} הגנה)` : "אין ציפוי פעיל"}</p>
      ${(data.jobs || []).map(j => `<div class="build-job" data-completes="${j.completes_at}" data-server="${data.server_time}"><b>${esc(data.catalog[j.material].name_he)}</b> - ${j.status === "building" ? "בבנייה" : "בתור"}<span class="build-countdown"></span><div class="worker-scene"><span>👷</span><span>🔨</span><span>👷</span></div></div>`).join("") || '<p class="sub">אין בנייה פעילה.</p>'}
      <div class="coating-grid">${order.map((m, i) => { const x=data.catalog[m]; const locked=i>activeLevel || queued.has(m); return `<div class="card coating-${m}"><h3>${esc(x.name_he)}</h3><p>${Math.round(x.hp)} הגנה · ${x.minutes} דקות</p><p class="price">🪙 ${x.price}</p><button class="btn small" data-build-coating="${m}" ${!data.enabled || locked || i<activeLevel ? "disabled" : ""}>${i<activeLevel ? "הושלם" : queued.has(m) ? "בתור" : i===activeLevel ? "התחל בנייה" : "נעול"}</button></div>`; }).join("")}</div></div>`;
    const tick = () => body.querySelectorAll(".build-job").forEach(job => {
      const left = Math.max(0, Number(job.dataset.completes) - Number(job.dataset.server) - (Date.now() - App._coatingClockStart) / 1000);
      const min = Math.floor(left / 60), sec = Math.floor(left % 60);
      job.querySelector(".build-countdown").textContent = ` · ${min}:${String(sec).padStart(2,"0")}`;
    });
    App._coatingClockStart = Date.now(); tick(); clearInterval(App._coatingTimer); App._coatingTimer = setInterval(tick, 1000);
    body.querySelectorAll("[data-build-coating]").forEach(btn => btn.onclick = async () => {
      const { status: built, data: result } = await API.post("/api/coatings/build", { material: btn.dataset.buildCoating });
      if (built === 200) { toast("הבנייה התחילה"); vAdmin(App, view, "coatings"); window.refreshMe?.(); }
      else toast(result.error_he || "הבנייה נכשלה");
    });
  } else if (tab === "cosmetics") {
    const loadCosmetics = async () => {
      const { status, data } = await API.get("/api/admin/cosmetics");
      if (status !== 200) { body.innerHTML = "<p>שגיאה בטעינת הקטלוג.</p>"; return; }
      body.innerHTML = `<div class="card"><h2>שליטת קטלוג קוסמטי</h2><p class="sub">מחיר וזמינות נשמרים בשרת.</p><table>
        <tr><th>פריט</th><th>דרגה</th><th>מחיר</th><th>זמין</th><th></th></tr>
        ${(data.cosmetics || []).map(c => `<tr><td>${esc(c.name_he || c.name)}<br><small>${esc(c.item_id)}</small></td>
          <td>${esc(c.tier || "common")}</td><td><input type="number" min="0" max="100000" value="${c.price}" data-price="${esc(c.item_id)}" style="width:100px"></td>
          <td><input type="checkbox" data-available="${esc(c.item_id)}" ${c.available === false ? "" : "checked"} style="width:auto"></td>
          <td><button class="btn small" data-savecos="${esc(c.item_id)}">שמור</button></td></tr>`).join("")}</table></div>`;
      body.querySelectorAll("[data-savecos]").forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.savecos;
        const price = parseInt(body.querySelector(`[data-price="${id}"]`).value, 10);
        const available = body.querySelector(`[data-available="${id}"]`).checked;
        const { status: st } = await API.post("/api/admin/cosmetics/" + encodeURIComponent(id), { price, available });
        toast(st === 200 ? "נשמר" : "שגיאה");
      });
    };
    loadCosmetics();
  } else if (tab === "audit") {
    const { status, data } = await API.get("/api/admin/audit");
    if (status !== 200) { body.innerHTML = `<p>שגיאה בטעינת היומן.</p>`; return; }
    body.innerHTML = `<div class="card"><p class="sub">${esc(data.notice || "")}</p><table>
      <tr><th>זמן</th><th>מנהל/משתמש</th><th>פעולה</th><th>יעד</th><th>פרטים</th></tr>
      ${(data.audit || []).map(a => `<tr><td>${esc(a.created_at.slice(0, 16).replace("T", " "))}</td>
        <td>${esc(a.actor_email || "מערכת")}</td><td>${esc(a.action)}</td>
        <td>${esc((a.target_type || "") + (a.target_id ? ":" + a.target_id : ""))}</td>
        <td class="audit-details">${esc(a.details || "")}</td></tr>`).join("")}
      </table></div>`;
  } else if (tab === "maintenance") {
    const { data: mt } = await API.get("/api/admin/maintenance");
    body.innerHTML = `<div class="card">
      <h2>🚧 מצב תחזוקה</h2>
      <label style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" id="mt-on" ${mt && mt.on ? "checked" : ""} style="width:auto">
        הצג באנר תחזוקה לכל השחקנים (בכל המסכים, כולל במשחק)</label>
      <label>נוסח ההודעה</label>
      <input id="mt-msg" value="${esc((mt && mt.message) || "")}" placeholder="למשל: תחזוקה מתוכננת הלילה ב-23:00">
      <button class="btn" id="mt-save" style="margin-top:12px">שמור</button></div>`;
    document.getElementById("mt-save").onclick = async () => {
      const { status: s, data: d } = await API.post("/api/admin/maintenance", {
        on: document.getElementById("mt-on").checked,
        message: document.getElementById("mt-msg").value });
      if (s === 200) { App.setMaintenance(d.maintenance); toast("נשמר"); }
      else toast("שגיאה");
    };
  } else if (tab === "broadcast") {
    body.innerHTML = `<div class="card">
      <label>כותרת</label><input id="bc-title">
      <label>תוכן ההודעה (תישלח לכל המשתמשים)</label>
      <input id="bc-body" style="height:80px">
      <button class="btn" id="bc-send" style="margin-top:12px">📢 שלח לכולם</button></div>`;
    document.getElementById("bc-send").onclick = async () => {
      const title = document.getElementById("bc-title").value;
      const b = document.getElementById("bc-body").value;
      const { status: s } = await API.post("/api/admin/broadcast", { title, body: b });
      toast(s === 200 ? "ההודעה שודרה לכל המשתמשים" : "שגיאה");
    };
  } else if (tab === "coupons") {
    body.innerHTML = `<div class="card">
      <h2>יצירת קופון</h2>
      <label>סוג</label>
      <select id="cp-kind"><option value="coins">מטבעות</option><option value="item">פריט</option></select>
      <label>סכום (אם מטבעות)</label><input id="cp-amount" type="number" value="100">
      <label>פריט (אם פריט)</label>
      <select id="cp-item"><option>טוען קטלוג...</option></select>
      <label>מספר מימושים</label><input id="cp-uses" type="number" value="1">
      <label>קוד (ריק = אקראי)</label><input id="cp-code">
      <button class="btn" id="cp-create" style="margin-top:12px">צור קופון</button></div>
      <div id="cp-list"></div>`;
    const catalogResult = await API.get("/api/store");
    document.getElementById("cp-item").innerHTML = Object.entries(catalogResult.data.catalog || {})
      .map(([id, item]) => `<option value="${esc(id)}">${esc(item.name_he || item.name || id)} (${esc(id)})</option>`).join("");
    const loadC = async () => {
      const { data } = await API.get("/api/admin/coupons");
      document.getElementById("cp-list").innerHTML = `<div class="card"><table>
        <tr><th>קוד</th><th>סוג</th><th>ערך</th><th>מימושים</th><th></th></tr>
        ${(data.coupons || []).map(c => `<tr><td><b>${esc(c.code)}</b></td>
          <td>${c.kind}</td><td>${c.kind === "coins" ? c.amount : c.item_id}</td>
          <td>${c.uses}/${c.max_uses}</td>
          <td><button class="btn small danger" data-delc="${esc(c.code)}">מחק</button></td></tr>`).join("")}
        </table></div>`;
      body.querySelectorAll("[data-delc]").forEach(b => b.onclick = async () => {
        await API.del("/api/admin/coupons/" + b.dataset.delc); loadC();
      });
    };
    document.getElementById("cp-create").onclick = async () => {
      const payload = {
        kind: document.getElementById("cp-kind").value,
        amount: parseInt(document.getElementById("cp-amount").value, 10) || 100,
        item_id: document.getElementById("cp-item").value,
        max_uses: parseInt(document.getElementById("cp-uses").value, 10) || 1,
        code: document.getElementById("cp-code").value,
      };
      const { status: s, data: d } = await API.post("/api/admin/coupons", payload);
      toast(s === 200 ? "נוצר קופון: " + d.code : (d.error || "שגיאה"));
      loadC();
    };
    loadC();
  } else if (tab === "matches") {
    const { data } = await API.get("/api/admin/matches");
    body.innerHTML = `<div class="card"><table>
      <tr><th>מזהה</th><th>סוג</th><th>סטטוס</th><th>עודכן</th></tr>
      ${(data.matches || []).map(m => `<tr><td>${esc(m.id)}</td><td>${m.mode}</td>
        <td>${m.status}</td><td>${esc(m.updated_at.slice(5, 16).replace("T", " "))}</td></tr>`).join("")}
      </table></div>`;
  }
}

export function install(App) {
  if (App._panelInstalled) return;
  App._panelInstalled = true;
  const st = document.createElement("style");
  st.textContent = PANEL_CSS;
  document.head.appendChild(st);
  for (const [k, v] of Object.entries(PANEL_STRINGS)) Lang.exact.set(k, v);
  const nav = document.querySelector("#topbar nav");
  if (nav && !document.getElementById("nav-admin")) {
    const a = document.createElement("a");
    a.href = "#/admin"; a.dataset.nav = "admin"; a.id = "nav-admin";
    a.textContent = "ניהול";
    nav.appendChild(a);
  }
  App._routeHook = (hash, view, seq) => {
    if (!hash.startsWith("#/admin")) return false;
    vAdmin(App, view, hash.split("/")[2] || "stats", seq);
    return true;
  };
  if ((location.hash || "").startsWith("#/admin")) App.route();
}
