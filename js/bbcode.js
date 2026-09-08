const TOKEN = /\b([a-z]+)(?:=([#0-9a-zA-Z_]+))?\b/g;

export function parseBBCode(src, smile) {
  const out = [];
  const stack = [];
  let pos = 0;
  const text = (t) => { if (t) out.push({ t: "text", v: t }); };

  const re = /\[(\/)?(b|i|u|s|small|xsmall|color|bgcolor|size|img|imgiconpack|imgsmilepack|imgembedded|imgcontent|url)(?:=([^\]]*))?\]/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    text(src.slice(pos, m.index));
    const kind = m[2].toLowerCase(), close = !!m[1];
    if (close) {
      const last = stack.lastIndexOf(kind);
      if (last >= 0) {
        stack.splice(last);
      }
      out.push({ t: "close", k: kind });
      pos = m.index + m[0].length;
      continue;
    }
    switch (kind) {
      case "b": case "i": case "u": case "s": case "small": case "xsmall":
        stack.push(kind);
        out.push({ t: "open", k: kind });
        break;
      case "color": case "bgcolor":
        stack.push(kind);
        out.push({ t: "open", k: kind, v: m[3] || "" });
        break;
      case "img": case "imgiconpack": case "imgsmilepack": case "imgembedded":
        out.push({ t: "open", k: "img", v: m[3] || "0" });
        stack.push("img");
        break;
      case "imgcontent":
        out.push({ t: "imgcontent", v: m[3] || "" });
        break;
      case "url":
        stack.push("url");
        out.push({ t: "open", k: "url", v: m[3] });
        break;
      case "size":
        stack.push("size");
        out.push({ t: "open", k: "size", v: m[3] || "3" });
        break;
    }
    pos = m.index + m[0].length;
  }
  text(src.slice(pos));
  return out;
}

export function renderBBCode(src, smileImg, avatarImg, smileCount) {
  const tokens = parseBBCode(src);
  const el = document.createElement("span");
  const appendText = (s) => {
    if (!s) return;
    el.appendChild(document.createTextNode(s));
  };
  let open = { b: 0, i: 0, u: 0, s: 0, small: 0, xsmall: 0, img: 0 };
  const wrap = (tag, attrs) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    el.appendChild(n);
    return n;
  };
  const wrappers = [];

  for (const tk of tokens) {
    if (tk.t === "text") {
      let s = tk.v;
      if (open.img === 0) {
        s = s.replace(/(^\s|[\s\S]*?)(::S(\d+)([A-Za-z]*|[!-~]+)::)/g, (mm, pre, whole, idx) => {
          const n = document.createTextNode(pre || "");
          el.appendChild(n);
          if (smileImg && idx < (smileCount == null ? 262144 : smileCount)) {
            const idxInt = parseInt(idx, 10);
            if (idxInt >= 0 && idxInt < smileCount) {
              const s = smileImg(idxInt);
              const img = wrap("img");
              img.className = "sm";
              img.src = s;
            } else {
              el.appendChild(document.createTextNode(whole));
            }
          } else {
            el.appendChild(document.createTextNode(whole));
          }
          return "";
        });
      }
      if (open.small) s = s.toLowerCase();
      appendText(s);
    } else if (tk.t === "open") {
      if (tk.k === "b") { open.b++; wrap("b"); }
      else if (tk.k === "i") { open.i++; wrap("i"); }
      else if (tk.k === "u") { open.u++; wrap("u"); }
      else if (tk.k === "s") { open.s++; wrap("s"); }
      else if (tk.k === "small") { open.small++; wrap("small"); }
      else if (tk.k === "xsmall") { open.xsmall++; wrap("small"); }
      else if (tk.k === "color") { open.color++; wrap("span", { style: "color:" + (tk.v || "#000") }); }
      else if (tk.k === "bgcolor") { open.bgcolor++; wrap("span", { style: "background:" + (tk.v || "#000") }); }
      else if (tk.k === "size") { wrap("span", { style: "font-size:" + (parseInt(tk.v, 10) * 16) + "px" }); }
      else if (tk.k === "img") { open.img++; }
      else if (tk.k === "url") { const a = wrap("a", { href: safeUrl(tk.v) || "#", target: "_blank", rel: "noopener" }); a.style.color = "#2a7de1"; }
    } else if (tk.t === "close") {
      if (tk.k === "b" && open.b) open.b--;
      if (tk.k === "i" && open.i) open.i--;
      if (tk.k === "u" && open.u) open.u--;
      if (tk.k === "s" && open.s) open.s--;
      if (tk.k === "small") open.small--;
      if (tk.k === "xsmall") open.xsmall--;
      if (tk.k === "img" && open.img) open.img--;
    }
  }
  return el;
}

function safeUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol === "http:" || x.protocol === "https:") return u;
  } catch (e) {}
  if (u && u.indexOf("http") === 0) return u;
  return null;
}