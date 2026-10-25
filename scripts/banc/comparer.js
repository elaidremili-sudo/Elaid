// Compare l'ancien calcul (test-65) et le nouveau (www/js/lean.js) sur 5 réalisations de chaque trajet simulé.
// Usage : node scripts/banc/comparer.js
const Module=require('module');const fs=require('fs');
function run(modPath){const out={};
 for(const seed of [0,1,7,13,21]){global.__W=require(modPath);
  let src=fs.readFileSync(__dirname+'/banc-inclinaison.js','utf8').replace(/if \(require.main[\s\S]*$/,'module.exports={report,SC};').replace("const MOD = require(path.resolve(process.argv[2] || path.join(__dirname, '../../www/js/lean.js')));","const MOD = global.__W;").replace("const SEED = +(process.argv[3] || 1);","const SEED = "+seed+";");
  const m=new Module(__dirname+'/z'+seed+'.js');m.paths=module.paths;m._compile(src,__dirname+'/z'+seed+'.js');
  for(const [n,c] of m.exports.SC){const r=m.exports.report(n,c);const o=out[n]=out[n]||{e:0,p:0,s:0,m:0,l:0,k:0};o.e+=r.virage_err_moy;o.p+=r.virage_err_p95;o.s+=r.droit_p95;o.m=Math.max(o.m,r.droit_max);o.l+=parseInt(r.alerte_tel_bouge);o.k++}}
 return out}
const A=run(__dirname+'/lean-test65.js'),B=run(require('path').join(__dirname,'../../www/js/lean.js'));
const rows=Object.keys(A).map(n=>{const a=A[n],b=B[n],f=(x,k)=>(x/k).toFixed(1);return {scenario:n,'erreur virage (ancien → nouveau)':f(a.e,a.k)+'° → '+f(b.e,b.k)+'°','p95 virage':f(a.p,a.k)+'° → '+f(b.p,b.k)+'°','ligne droite p95':f(a.s,a.k)+'° → '+f(b.s,b.k)+'°','ligne droite pire':a.m.toFixed(0)+'° → '+b.m.toFixed(0)+'°','alerte « tél. bouge »':Math.round(a.l/a.k)+' % → '+Math.round(b.l/b.k)+' %'}});
console.table(rows);if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,1));
