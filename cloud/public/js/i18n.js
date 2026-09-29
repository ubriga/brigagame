// Lightweight, persistent whole-app language layer. It also translates DOM
// added later by game/store views, so one user choice covers every route.
const Lang = {
  current: (() => {
    const stored = (typeof Consent !== "undefined" ? Consent.getPref("brigagame_lang") : localStorage.getItem("brigagame_lang"));
    if (stored === "en" || stored === "he") return stored;
    const nav = String((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
    return (nav.startsWith("he") || nav.startsWith("iw")) ? "he" : "en";
  })(),
  exact: new Map(Object.entries({
    "לובי":"Lobby","תגים":"Tags","📨 הזמן חבר":"📨 Invite a friend","🎖️ התגים שלי":"🎖️ My tags","תגים מיוחדים שצברת במשחק.":"Special tags you earned in the game.","עדיין אין לך תגים.":"No tags yet.","⚔️ נכנסים לקרב":"⚔️ To battle","🚀 הצטרפה למשחק":"🚀 Join the game","חזרה ללובי":"Back to lobby","לכניסה למשחק":"To sign in","חנות":"Shop","ההתאמה שלי":"My collection","דירוג":"Leaderboard","הודעות":"Messages",
    "התקנה":"Install","התנתקות":"Sign out","השתקה":"Mute","מתחבר מחדש...":"Reconnecting...","בקרוב":"Coming soon",
    "משחקים":"Matches","קוסמטיקה":"Cosmetics","קופונים":"Coupons","תחזוקה":"Maintenance",
    "רגיל":"Common","נדיר":"Rare","אפי":"Epic","אגדי":"Legendary",
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
    
    
    "שלום,":"Hello,","הפל את מגדל היריב לפני שהוא מפיל את שלך.":"Destroy the enemy tower before it destroys yours.","🎮 משחק":"🎮 Play",
    "⚡ משחק מהיר":"⚡ Quick match","🤖 משחק מול בוט":"🤖 Play vs bot","🔗 משחק חברים (צור קוד)":"🔗 Friend match (create code)","הצטרף":"Join",
    "רמת קושי":"Difficulty","קוד משחק":"Match code","📊 הסטטיסטיקה שלך":"📊 Your statistics","דרגה נוכחית:":"Current rank:","הבאה:":"Next:",
    "דירוג":"Rating","נצחונות":"Wins","הפסדים":"Losses","🎁 בונוס יומי (נאסף)":"🎁 Daily bonus (collected)","🎁 בונוס יומי":"🎁 Daily bonus",
    "רצף ימי התחברות":"Daily login streak","יאללה!":"Let's go!","סגור":"Close","קיבלת":"You got","מטבעות":"coins","הרצף נמשך!":"The streak continues!",
    "משחק חינמי, ללא פרסים או ערך כספי":"Free game, no prizes or monetary value","הצג הודעת תחזוקה":"Show maintenance notice",
    "להתקין את Brigagame?":"Install Brigagame?","גישה מהירה ומסך מלא לרוחב":"Quick access and full-screen landscape mode",
    "🛒 חנות":"🛒 Shop","יתרה:":"Balance:","🎟️ מימוש קופון":"🎟️ Redeem coupon","קוד קופון":"Coupon code","ממש":"Redeem",
    "⚔️ נשקים מיוחדים":"⚔️ Special weapons","🛡️ שדרוגי מגדל":"🛡️ Tower upgrades","🎨 מראה":"🎨 Cosmetics","בתיק:":"Inventory:","שימושים":"uses",
    "בבעלותך - לחץ להחיל":"Owned - click to equip","✓ המראה הפעיל שלך":"✓ Your active cosmetic","נקנה והוחל! יופיע במשחק הבא":"Purchased and equipped! It will appear next match",
    "המראה הוחל - יופיע במשחק הבא":"Cosmetic equipped - it will appear next match",
    
    "מול שחקן אמיתי אקראי - נספר לדירוג":"Vs a random real player - ranked","מול המחשב - רמה קלה היא תרגול שלא נספר לדירוג":"Vs the computer - easy is unranked practice","יוצר קוד לשיתוף חבר - הוא מזין אותו בשדה \"קוד משחק\" כאן למטה":"Creates a code to share - your friend enters it in the \"Match code\" field below","❓ איך משחקים?":"❓ How to play?","🟢 שתף בוואטסאפ":"🟢 Share on WhatsApp","החבר נכנס לאתר, מתחבר, ומזין את הקוד בשדה \"קוד משחק\" בלובי":"Your friend opens the site, signs in, and enters the code in the \"Match code\" field in the lobby","🎯 מוכן לירייה! גרור מהמגדל שלך לכיוון המטרה ושחרר":"🎯 Ready to fire! Drag from your tower toward the target and release","הבוט מתכונן לירייה הראשונה...":"The bot is preparing its first shot...","זמן להסתכל על הזווית, העוצמה והרוח":"Time to check the angle, power and wind","המשחק הראשון שלך!":"Your first match!","הבנתי!":"Got it!","הבנתי, יאללה!":"Got it, let's go!","🎓 משחק ראשון?":"🎓 First match?","מומלץ להתחיל מול בוט קל - משחק תרגול בלי דירוג ובלי לחץ. אפשר גם לפתוח את \"איך משחקים?\" למטה.":"Start with an easy bot - unranked practice. You can also open \"How to play?\" below.",
    "🎯 משחק תרגול - לא נספר לדרגה":"🎯 Practice match - does not affect rank","גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז ומשתנה אחרי כל ירייה, ובכל משחק המגדלים במיקומים אחרים.":"Drag from your tower to aim and release to fire. Wind moves the shell and changes after every shot; tower positions vary each match.",
    "⌨️ מקלדת:":"⌨️ Keyboard:","ירייה":"fire","בחירת נשק":"choose weapon","יוצא...":"Exiting...","יציאה ממשחק פעיל תיספר כהפסד בדירוג":"Leaving an active match counts as a ranked loss","יציאה ממשחק תרגול לא תשפיע על הדירוג":"Leaving a practice match does not affect rank",
    "פגיעה קריטית בקנה התותח!":"Critical cannon hit!","משב רוח קיצוני":"Extreme wind gust","מטאור פגע בזירה":"A meteor hit the arena","מטען מגה נוסף":"Extra mega charge",
    "מוות פתאומי - הנזק הוכפל!":"Sudden death - damage doubled!","הזמן נגמר - לשני המגדלים אותה שלמות.":"Time is up - both towers have equal integrity.",
    "משחק תרגול - לא נספר לדרגה":"Practice match - does not affect rank","המשחק הסתיים מסיבה טכנית - ללא ניצחון, הפסד או מטבעות.":"The match ended for a technical reason - no win, loss, or coins.",
    "ריבאנץ' נגד OrelAI Bot":"Rematch against OrelAI Bot","יוצר משחק...":"Creating match...","שגיאה ביצירת משחק":"Could not create match",
    "הדירוג עולה ויורד לפי נצחונות והפסדים.":"Rating rises and falls with wins and losses.","הטבלה מסודרת לפי נקודות דרגה. הנקודות קובעות את הדרגה ואת ההתקדמות לדרגה הבאה.":"The table is ordered by rank points. Rank points determine your military rank and progress to the next rank.","טבלת דירוג":"Leaderboard","שחקן":"Player","נקודות דרגה":"Rank points","הפ׳":"L","נצ׳":"W",
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
    "טוען…":"Loading…","משחקים פעילים":"Active matches","מטבעות הונפקו":"Coins issued","מטבעות הוצאו":"Coins spent","חסומים":"Blocked",
    "(נאסף)":"(collected)","כל קובייה מוסיפה":"Each cube adds","איך משחקים?":"How to play?","בנה קובייה":"Build a cube",
    "בעיית חיבור - לא בוצעה רכישה":"Connection problem - no purchase was made","ברצף!":"in a row!","ברצף! קיבלת":"in a row! You got","יום ":"Day ",
    "גוררים מהמגדל שלך לכיוון היריב - הגרירה קובעת זווית ועוצמה - ומשחררים. מדדי הזווית והעוצמה למטה מראים את הכיוון הנוכחי.":"Drag from your tower toward the enemy - the drag sets angle and power - and release. The angle and power gauges below show the current direction.",
    "דווח לנו":"Report to us","דקות · ההתקדמות לא נשמרת":"minutes · progress is not kept","דקות · 🪙":"minutes · 🪙",
    "הבנייה התחילה - הפועלים כבר עובדים":"Build started - the workers are on it","הבנייה נכשלה":"Build failed","ההזמנה לא נמצאה 😕":"Invitation not found 😕",
    "ההזמנה תיסגר בעוד":"Invitation closes in","ההחלה נכשלה - נסה שוב":"Equip failed - try again","ההתחברות נכשלה":"Sign-in failed",
    "הזזה מזיזה את המגדל צעד, מגן סופג פגיעה, מגה היא ירייה עוצמתית. תחמושת מיוחדת (כפולה, מסתובב, מרושת) נקנית בחנות במטבעות.":"Move shifts the tower one step, Shield absorbs a hit, Mega is a powerful shot. Special ammo (Double, Homing, Cluster) is bought in the shop with coins.",
    "החץ ליד גלולת הרוח למעלה מזיז את הפגז במעופו. הרוח משתנה אחרי כל ירייה - בודקים לפני כל יריה.":"The arrow next to the wind pill at the top moves the shell mid-flight. Wind changes after every shot - check before each shot.",
    "המשחק בתחזוקה זמנית":"The game is under temporary maintenance","המשחק כבר לא זמין":"The match is no longer available","העתק את קישור ההזמנה:":"Copy the invitation link:",
    "הקובייה בתהליך בנייה":"Cube build in progress","הקוד הועתק":"Code copied","הקוד יגיע מ-":"The code will arrive from","הקוד לא תקין":"Invalid code",
    "הקוד שגוי. נסה שוב.":"Wrong code. Try again.","השרת לא ענה כרגע. בדוק את חיבור האינטרנט ונסה שוב בעוד רגע.":"The server did not respond. Check your internet connection and try again in a moment.",
    "התחברות יומית מעלה את הרצף ונותנת מטבעות אוטומטית. יום שמדולג מאפס את הרצף.":"Daily sign-in raises the streak and grants coins automatically. A skipped day resets the streak.",
    "חברך":"Your friend","קורא לך לקרב":"calls you to battle","חוזרים לפעילות:":"Back in action:","יכולות:":"Abilities:","ימים":"days",
    "יצירת ההזמנה נכשלה":"Could not create the invitation","יש 10 שניות לירות ברגע שהתותח טעון. באפס - הירייה יוצאת אוטומטית בכיוון הנוכחי.":"You have 10 seconds to fire once the cannon is loaded. At zero - the shot fires automatically in the current direction.",
    "כניסת אורחים נכשלה. נסה שוב.":"Guest sign-in failed. Try again.","כניסת פיתוח (מקומית בלבד)":"Dev sign-in (local only)","כניסת פיתוח כבויה":"Dev sign-in disabled",
    "לא הצלחנו להתחיל משחק נגד הבוט":"Could not start a match vs the bot","לא מוצאים? בדקו גם בתיקיית הספאם.":"Can't find it? Check the spam folder too.","להמשיך לחכות":"Keep waiting",
    "להפיל את מגדל היריב לפני שהוא מפיל את שלך. כל פגיעה מפרקת עוד חלק מהמגדל.":"Destroy the enemy tower before it destroys yours. Every hit breaks another part of the tower.",
    "מגייס":"Recruiter","מומלץ: כניסה עם קוד למייל":"Recommended: sign in with an email code","מחכה ליריב...":"Waiting for an opponent...","מטבעות! רצף:":"coins! Streak:",
    "מטרה:":"Goal:","ממשיכים לחפש יריב...":"Still looking for an opponent...","ממתין שהחבר יצטרף...":"Waiting for your friend to join...","מראים נוספים מחכים ב":"More cosmetics await in",
    "מתוך":"of","מתחיל...":"Starting...","נכנסים...":"Entering...","נמצא יריב!":"Opponent found!","נקודות חיים ומרחיבה את שטח הפגיעה.":"health points and expands the damage area.",
    "נשאר בתוך האפליקציה.":"stays inside the app.","נשלח קוד למייל - בדוק גם בספאם":"Code sent - check spam too","עדיין אין ציפוי פעיל.":"No active coating yet.","עדיין לא עובד?":"Still not working?",
    "קוביות נוספות:":"Extra cubes:","קופון לא תקין":"Invalid coupon","קישור ההזמנה הועתק - שלח אותו לחבר 📨":"Invitation link copied - send it to a friend 📨",
    "קישור ההזמנה לא תקף, פג תוקפו או שכבר נוצל.":"The invitation link is invalid, expired, or already used.","רוח:":"Wind:","רצף יומי - יום":"Daily streak - day","שבת שלום!":"Shabbat shalom!",
    "שגיאה באיסוף הבונוס היומי":"Error collecting the daily bonus","שגיאה בהחלת המראה":"Error equipping the cosmetic","שגיאה ביצירת משחק חברים":"Error creating a friend match",
    "שגיאה ביצירת משחק מהיר":"Error creating a quick match","שגיאה ביצירת משחק מול בוט":"Error creating a bot match","שחק נגד הבוט":"Play vs the bot","שלום":"Hello",
    "שליחת הקוד נכשלה. נסה שוב.":"Failed to send the code. Try again.","שלך":"yours","שניות":"seconds","שעון ירייה:":"Shot clock:","שעות ו-":"hours and",
    "▫️ כל יום: 🪙":"▫️ Every day: 🪙","✉️ הגיעה הודעה חדשה! פתח את ״הודעות״ לקריאה":"✉️ New message! Open \"Messages\" to read it",
    "🎉 ההתקדמות נשמרה! ברוך הבא":"🎉 Progress saved! Welcome","🎉 הצטרפת דרך ההזמנה של":"🎉 You joined via the invitation of","🎉 מומש:":"🎉 Redeemed:",
    "🎭 חשבון אורח - נמחק בעוד":"🎭 Guest account - deletes itself in","📲 באפליקציה המותקנתת, כניסה עם גוגל נפתחת בדפדפן חיצוני ולא מחברת את האפליקציה.":"📲 In the installed app, Google sign-in opens in an external browser and does not sign into the app.",
    "🔥 רצף יומי · יום":"🔥 Daily streak · day","🤖 התחל משחק מול בוט":"🤖 Start a bot match","🤖 לא נמצא יריב עדיין - לשחק מיד נגד הבוט?":"🤖 No opponent yet - play vs the bot now?",
    "בעיה בטעינת המשחק":"Problem loading the match","גרור מהמגדל שלך (הכחול, בצד שלך) לכיוון היריב ושחרר כדי לירות.":"Drag from your tower (the blue one, on your side) toward the enemy and release to fire.",
    "הזמן נגמר - למגדל":"Time is up - the tower","טיל מתביית - מתקן מסלול לארץ. נקנה בחנות במטבעות":"Homing missile - corrects its path. Bought in the shop with coins",
    "נשארה יותר שלמות.":"has more integrity remaining.","פגז מצרר - מתפזר לכמה פגיעות. נקנה בחנות במטבעות":"Cluster shell - splits into several hits. Bought in the shop with coins",
    "פגז רגיל - ללא הגבלה":"Standard shell - unlimited","פצצה כפולה - שתי פגיעות. נקנית בחנות במטבעות":"Double bomb - two hits. Bought in the shop with coins",
    "⏳ יש 10 שניות לכל ירייה · ❓ כאן למעלה פותח מדריך מלא":"⏳ 10 seconds per shot · ❓ Above opens the full guide","⚡ אירוע אקראי:":"⚡ Random event:",
    "💨 הרוח מזיזה את הפגז - היא משתנה אחרי כל ירייה.":"💨 Wind moves the shell - it changes after every shot.","🔥 נזק כפול":"🔥 Double damage",
    "Brigagame 2.0 - משחק ארטילריה מולטיפלייר. הפל את מגדל היריב!":"Brigagame 2.0 - a multiplayer artillery game. Destroy the enemy tower!",
    "✓ סמן הכל כנקרא":"✓ Mark all as read","כשיגיעו עדכונים, הם יופיעו כאן.":"When updates arrive, they will appear here.",
    "חדש":"New","היום":"Today","אתמול":"Yesterday","אין הודעות עדיין":"No messages yet",
    "הירשם כדי לראות את הטבלה":"Sign up to see the leaderboard",
    "טבלת הדירוג פתוחה לשחקנים רשומים בלבד. הרישום חינם, וכל ההתקדמות שצברת כאורח עוברת איתך.":"The leaderboard is open to registered players only. Sign-up is free, and all the progress you made as a guest carries over.",
    "הודעות זמינות לשחקנים רשומים בלבד.":"Messages are available to registered players only.",
    "תגים זמינים לשחקנים רשומים בלבד.":"Tags are available to registered players only.",
    "החנות זמינה לשחקנים רשומים בלבד. הרישום חינם, וכל ההתקדמות שצברת כאורח עוברת איתך.":"The shop is available to registered players only. Sign-up is free, and all the progress you made as a guest carries over.",
    "סדנת המגדל זמינה לשחקנים רשומים בלבד. הרישום חינם, וכל ההתקדמות שצברת כאורח עוברת איתך.":"The tower workshop is available to registered players only. Sign-up is free, and all the progress you made as a guest carries over.",
    "הירשם בחינם":"Sign up free",
    "⚡ משחק מהיר מדורג זמין לשחקנים רשומים - אפשר מול בוט, או להירשם ולשמור את ההתקדמות":"⚡ Ranked quick match is available to registered players - you can play vs a bot, or sign up to save your progress",
    "🎭 משחק אורח":"🎭 Guest mode",
    "משחק אורח: הסטטיסטיקה לא נשמרת בין סשנים והחשבון נמחק אוטומטית. אורחים לא מופיעים בטבלת הדירוג. רוצה לשמור הכל?":"Guest mode: stats are not saved between sessions and the account deletes itself automatically. Guests don't appear on the leaderboard. Want to keep everything?",
    "- ההתקדמות עוברת איתך.":"- your progress carries over.",
    "רמת קושי מול בוט:":"Difficulty vs bot:",
    "🎭 שחק כאורח":"🎭 Play as guest","בלי הרשמה · חשבון זמני שנמחק אוטומטית":"No sign-up · a temporary account that deletes itself automatically",
    "🟢 כניסה עם חשבון גוגל":"🟢 Sign in with Google","או כניסה עם קוד למייל:":"Or sign in with an email code:","המייל שלך":"Your email","שלח לי קוד כניסה":"Send me a sign-in code","קוד בן 6 ספרות":"6-digit code","חזרה":"Back","מתחבר…":"Signing in…",
    "בהתחברות אתה מאשר את":"By signing in you agree to the","תנאי השימוש":"Terms of Service","מדיניות הפרטיות":"privacy policy","משחק ארטילריה מולטיפלייר - הפל את מגדל היריב!":"A multiplayer artillery game - destroy the enemy tower!",
    "גרור מהמגדל שלך כדי לכוון ושחרר כדי לירות. הרוח מזיזה את הפגז, ובכל משחק המגדלים במיקומים אחרים.":"Drag from your tower to aim, release to fire. Wind pushes the shell, and tower positions change every match.",
    "🎭 מצב אורח":"🎭 Guest mode","הגדרות המשחק נשמרו":"Game settings saved"
  })),
  words: [],
  text(value) {
    if (this.current !== "en" || !value || !/[א-ת]/.test(value)) return value;
    const trim=value.trim(), direct=this.exact.get(trim);
    if (direct) return value.replace(trim,direct);
    let out=value;
    // Phrase replacement is boundary-aware: a dictionary source matches only
    // when it is not glued to more Hebrew letters, so "חדש" never eats "חדשה"
    // and "תיקו" never eats "תיקוני" inside server-provided content.
    for (const [he,en] of [...this.exact].sort((a,b)=>b[0].length-a[0].length)) {
      if (!out.includes(he)) continue;
      const re = new RegExp("(?<![\u05D0-\u05EA])" + he.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\u05D0-\u05EA])", "g");
      out = out.replace(re, en);
    }
    for (const [re,en] of this.words) out=out.replace(re,en);
    return out;
  },
  apply(root=document) {
    document.documentElement.lang=this.current;
    document.documentElement.dir=this.current === "en" ? "ltr" : "rtl";
    if (this.current !== "en") return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:(n)=>{
      const p=n.parentElement;
      if(!p||['SCRIPT','STYLE'].includes(p.tagName)||p.closest('[data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n=>{ n.nodeValue=this.text(n.nodeValue); });
    root.querySelectorAll?.('[title],[aria-label],[placeholder]').forEach(el=>['title','aria-label','placeholder'].forEach(a=>{if(el.hasAttribute(a))el.setAttribute(a,this.text(el.getAttribute(a)))}));
  },
  set(lang) { Consent.setPref("brigagame_lang",lang); location.reload(); },
  boot() {
    this.apply();
    new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)this.apply(n);else if(n.nodeType===3&&!n.parentElement?.closest('[data-i18n-skip]'))n.nodeValue=this.text(n.nodeValue)}))).observe(document.body,{subtree:true,childList:true});
    const b=document.getElementById('lang-btn'); if(b){b.textContent=this.current==='en'?'עברית':'EN';b.onclick=()=>this.set(this.current==='en'?'he':'en');}
  },
  pick(item,key='name'){ return this.current==='en' ? (item[key] || item.name) : (item[key+'_he'] || item[key] || item.name); }
};
