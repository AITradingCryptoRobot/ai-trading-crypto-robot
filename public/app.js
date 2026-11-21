const $ = id => document.getElementById(id);
let authMode = "login";
let currentUser = null;
const fmt = n => Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const money = n => "$" + fmt(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
$("year").textContent = new Date().getFullYear();

async function api(url, options={}) {
  const response = await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function openAuth(mode="login") {
  authMode=mode; $("authModal").classList.remove("hidden"); updateAuthForm();
}
function updateAuthForm() {
  const register=authMode==="register";
  $("authTitle").textContent=register?"Create your account":"Sign in";
  $("authName").classList.toggle("hidden",!register);
  $("authName").required=register;
  $("authPassword").autocomplete=register?"new-password":"current-password";
  $("authSubmit").textContent=register?"Create account":"Sign in";
  $("authFeedback").textContent="";
}
$("authNav").onclick=()=>openAuth(currentUser?"login":"login");
$("heroStart").onclick=()=>currentUser?document.querySelector("#dashboard").scrollIntoView({behavior:"smooth"}):openAuth();
$("closeAuth").onclick=()=>$("authModal").classList.add("hidden");
$("showLogin").onclick=()=>{authMode="login";updateAuthForm()};
$("showRegister").onclick=()=>{authMode="register";updateAuthForm()};
$("authForm").onsubmit=async e=>{
  e.preventDefault(); $("authFeedback").textContent="Please wait…";
  try{
    const endpoint=authMode==="register"?"/api/auth/register":"/api/auth/login";
    const payload={email:$("authEmail").value,password:$("authPassword").value};
    if(authMode==="register")payload.name=$("authName").value;
    const result=await api(endpoint,{method:"POST",body:JSON.stringify(payload)});
    currentUser=result.user; $("authModal").classList.add("hidden"); await loadDashboard();
  }catch(err){$("authFeedback").textContent=err.message}
};
$("logoutBtn").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});currentUser=null;$("dashboard").classList.add("hidden");$("authNav").textContent="Sign in";};
async function checkSession(){
  try{const d=await api("/api/auth/me");currentUser=d.user;await loadDashboard()}catch{}
}
async function loadDashboard(){
  $("dashboard").classList.remove("hidden");$("authNav").textContent=currentUser.role==="admin"?"Admin account":"My account";
  const d=await api("/api/dashboard");
  $("tradeCount").textContent=d.stats.tradeCount;
  $("buyValue").textContent=money(d.stats.buyCost);
  $("sellValue").textContent=money(d.stats.sellValue);
  $("botSymbol").value=d.bot.symbol;
  $("botStatus").textContent=d.bot.running?"RUNNING · PAPER":"STOPPED";
  $("botMessage").textContent=d.bot.running?"Paper strategy is enabled. No live orders are placed.":"Bot is stopped.";
  $("tradeRows").innerHTML=d.trades.length?d.trades.map(t=>`<tr><td>${esc(t.created_at)}</td><td>${esc(t.symbol)}</td><td class="${t.side==="BUY"?"positive":"negative"}">${esc(t.side)}</td><td>${Number(t.quantity).toFixed(6)}</td><td>${money(t.price)}</td><td>${money(t.quote_value)}</td></tr>`).join(""):'<tr><td colspan="6" class="muted">No simulated trades yet. Start the paper bot to begin.</td></tr>';
  if(currentUser.role==="admin")loadAdmin();
  loadChart();
}
async function loadAdmin(){
  $("adminPanel").classList.remove("hidden");
  try{const d=await api("/api/admin/summary");$("adminStats").textContent=`${d.count} registered users · ${d.tradeCount} paper trades`;
  $("adminRows").innerHTML=d.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.created_at)}</td></tr>`).join("")}
  catch(e){$("adminStats").textContent=e.message}
}
async function loadMarkets(){
  try{
    const rows=await api("/api/market/tickers");
    const names={BTCUSDT:"Bitcoin",ETHUSDT:"Ethereum",BNBUSDT:"BNB",SOLUSDT:"Solana",XRPUSDT:"XRP",ADAUSDT:"Cardano",DOGEUSDT:"Dogecoin"};
    $("marketRows").innerHTML=rows.map(x=>`<tr><td class="coin">${names[x.symbol]||x.symbol}</td><td>${x.symbol}</td><td>${money(x.price)}</td><td class="${x.changePercent>=0?"positive":"negative"}">${x.changePercent>=0?"+":""}${x.changePercent.toFixed(2)}%</td><td>${(x.volume/1e6).toFixed(2)}M</td></tr>`).join("");
    $("marketUpdated").textContent="Updated "+new Date().toLocaleTimeString();
  }catch(e){$("marketRows").innerHTML=`<tr><td colspan="5" class="muted">${esc(e.message)}. Refresh to retry.</td></tr>`;$("marketUpdated").textContent="Unavailable"}
}
async function loadChart(){
  try{
    const candles=await api("/api/market/klines/BTCUSDT?interval=1h");
    const canvas=$("priceChart"),ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);const vals=candles.map(c=>c.close),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
    ctx.beginPath();vals.forEach((v,i)=>{const x=i/(vals.length-1)*w,y=h-15-(v-min)/range*(h-30);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
    ctx.strokeStyle="#e9b949";ctx.lineWidth=3;ctx.stroke();
  }catch{}
}
$("startBot").onclick=async()=>{
  try{const d=await api("/api/bot/start",{method:"POST",body:JSON.stringify({symbol:$("botSymbol").value})});$("botMessage").textContent=d.message;await loadDashboard()}
  catch(e){$("botMessage").textContent=e.message}
};
$("stopBot").onclick=async()=>{
  try{const d=await api("/api/bot/stop",{method:"POST"});$("botMessage").textContent=d.message;await loadDashboard()}
  catch(e){$("botMessage").textContent=e.message}
};
loadMarkets();setInterval(loadMarkets,30000);checkSession();
