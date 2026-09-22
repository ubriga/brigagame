// Lightweight procedural premium tower ornaments. These paths add no image
// downloads and preserve the server-owned destructible 4x6 block hitbox.
const PremiumTowerArt = {
  draw(ctx, geometry, box, style, t = 0, side = "p1", layer = "back") {
    if (!geometry) return;
    const { x, y, w, h, ground } = box;
    const light = (style.fill || style.colors || ["#fff"])[0];
    const dark = (style.fill || style.colors || ["#fff", "#334155"])[1] || light;
    const frame = style.frame || "#fff";
    const f = side === "p2" ? -1 : 1;
    const pulse = .5 + .5 * Math.sin(t / 420);
    const poly = pts => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, p[0], p[1])); ctx.closePath(); };
    const fillStroke = (fill = dark, line = frame, width = 2) => { ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = width; ctx.stroke(); };
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (style.glow) { ctx.shadowColor = style.glow; ctx.shadowBlur = 5 + pulse * 5; }

    if (layer === "back") {
      if (geometry === "missile") {
        poly([[x + w*.18,y+8],[x+w*.5,y-38],[x+w*.82,y+8]]); fillStroke(light);
        poly([[x+5,ground-50],[x-22,ground-8],[x+14,ground-18]]); fillStroke(dark);
        poly([[x+w-5,ground-50],[x+w+22,ground-8],[x+w-14,ground-18]]); fillStroke(dark);
      } else if (geometry === "spaceship") {
        ctx.beginPath(); ctx.ellipse(x+w/2,y+12,w*.72,25,0,0,Math.PI*2); fillStroke(dark);
        ctx.beginPath(); ctx.ellipse(x+w/2,y+2,w*.28,27,0,0,Math.PI*2); fillStroke(light);
        for (const ox of [-.48,-.25,0,.25,.48]) { ctx.fillStyle = ox === 0 ? "#fef08a" : "#67e8f9"; ctx.beginPath(); ctx.arc(x+w/2+w*ox,y+14,4,0,7); ctx.fill(); }
      } else if (geometry === "tank") {
        ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(x-18,ground-28,w+36,28,12); ctx.fill();
        for (let i=0;i<6;i++) { ctx.fillStyle="#111827"; ctx.beginPath(); ctx.arc(x-4+i*(w+8)/5,ground-13,8,0,7); ctx.fill(); ctx.strokeStyle=frame; ctx.stroke(); }
      } else if (geometry === "dragon") {
        poly([[x+4,y+35],[x-34,y+58],[x-10,y+82],[x-42,y+102],[x+8,y+112]]); fillStroke(dark);
        poly([[x+w-4,y+35],[x+w+34,y+58],[x+w+10,y+82],[x+w+42,y+102],[x+w-8,y+112]]); fillStroke(dark);
        ctx.strokeStyle=frame; ctx.lineWidth=7; ctx.beginPath(); ctx.moveTo(x+w,ground-45); ctx.quadraticCurveTo(x+w+48,ground-22,x+w+30,ground+2); ctx.stroke();
      } else if (geometry === "pyramid") {
        poly([[x+w/2,y-35],[x-34,ground],[x+w+34,ground]]); fillStroke(dark);
        ctx.strokeStyle=frame; ctx.globalAlpha=.45; ctx.lineWidth=2;
        for(let i=1;i<5;i++){const yy=y-35+i*(h+35)/5;ctx.beginPath();ctx.moveTo(x+w/2-(yy-y+35)*.55,yy);ctx.lineTo(x+w/2+(yy-y+35)*.55,yy);ctx.stroke();}
      } else if (geometry === "ice_fortress") {
        poly([[x-12,ground],[x-12,y+30],[x+4,y-30],[x+22,y+30],[x+w*.5,y-48],[x+w-22,y+30],[x+w-4,y-24],[x+w+12,y+30],[x+w+12,ground]]); fillStroke("rgba(186,230,253,.48)",frame,3);
      } else if (geometry === "mecha") {
        ctx.fillStyle=dark; ctx.strokeStyle=frame; ctx.lineWidth=3;
        ctx.beginPath(); ctx.roundRect(x-25,y+32,25,h-18,8); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(x+w,y+32,25,h-18,8); ctx.fill(); ctx.stroke();
        for(const sx of [x-12,x+w+12]){ctx.beginPath();ctx.arc(sx,y+25,18,0,7);ctx.fill();ctx.stroke();}
      } else if (geometry === "castle") {
        ctx.fillStyle=dark; ctx.strokeStyle=frame; ctx.lineWidth=3;
        for(const sx of [x-24,x+w]){ctx.beginPath();ctx.roundRect(sx,y+18,24,h-18,3);ctx.fill();ctx.stroke();
          for(let i=0;i<3;i++)ctx.fillRect(sx+i*9,y+7,7,18);}
      }
    } else {
      ctx.shadowBlur = 0;
      if (geometry === "missile") {
        ctx.fillStyle="#67e8f9"; ctx.strokeStyle=frame; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x+w/2,y+21,10,0,7); ctx.fill(); ctx.stroke();
        for(let i=0;i<3;i++){ctx.fillStyle=["#fef08a","#fb923c","#ef4444"][i];ctx.globalAlpha=.72;ctx.beginPath();ctx.ellipse(x+w/2+(i-1)*10,ground+8,5,10+pulse*5,0,0,7);ctx.fill();}
      } else if (geometry === "spaceship") {
        ctx.strokeStyle="#67e8f9";ctx.lineWidth=3;ctx.globalAlpha=.75+.25*pulse;ctx.beginPath();ctx.ellipse(x+w/2,ground-55,w*.38,h*.24,0,0,7);ctx.stroke();
      } else if (geometry === "tank") {
        ctx.fillStyle=dark;ctx.strokeStyle=frame;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(x+w/2,y+8,w*.28,19,0,0,7);ctx.fill();ctx.stroke();
        ctx.beginPath();ctx.moveTo(x+w/2+f*8,y+8);ctx.lineTo(x+w/2+f*75,y-2);ctx.lineWidth=9;ctx.stroke();
      } else if (geometry === "dragon") {
        for(const sx of [x+w*.32,x+w*.68]){poly([[sx,y+5],[sx+(sx<x+w/2?-14:14),y-31],[sx+(sx<x+w/2?10:-10),y-4]]);fillStroke(light);}
        ctx.fillStyle="#fde047";for(const sx of [x+w*.4,x+w*.6]){ctx.beginPath();ctx.arc(sx,y+28,4,0,7);ctx.fill();}
      } else if (geometry === "pyramid") {
        ctx.fillStyle="#fef08a";ctx.strokeStyle=frame;ctx.lineWidth=2;poly([[x+w/2,y+35],[x+w/2-18,y+62],[x+w/2+18,y+62]]);fillStroke("#fef08a");
      } else if (geometry === "ice_fortress") {
        ctx.strokeStyle="#e0f2fe";ctx.lineWidth=3;ctx.globalAlpha=.55+.35*pulse;for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(x+12+i*w/4,y+15);ctx.lineTo(x+6+i*w/4,y+75);ctx.stroke();}
      } else if (geometry === "mecha") {
        ctx.fillStyle="#67e8f9";ctx.globalAlpha=.7+.3*pulse;ctx.fillRect(x+w*.22,y+36,w*.56,8);ctx.strokeStyle=frame;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+w/2,y);ctx.lineTo(x+w/2,y-25);ctx.lineTo(x+w/2+12,y-34);ctx.stroke();
      } else if (geometry === "castle") {
        ctx.fillStyle="#facc15";ctx.globalAlpha=.8;for(const sx of [x-12,x+w+12]){ctx.beginPath();ctx.moveTo(sx,y+5);ctx.lineTo(sx+f*25,y+13);ctx.lineTo(sx,y+23);ctx.fill();}
      }
    }
    ctx.restore();
  }
};
