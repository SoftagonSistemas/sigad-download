// Renderiza um HTML para PDF (A4) com rodapé padrão (linha + nº de página) via Chrome DevTools
// Protocol (Page.printToPDF). Roda com bun (WebSocket/fetch globais). Uso:
//   bun render-pdf.js <input.html> <output.pdf>
const [,, inPath, outPath] = process.argv
if (!inPath || !outPath) { console.error('uso: bun render-pdf.js <in.html> <out.pdf>'); process.exit(1) }

const fileUrl = 'file://' + (inPath.startsWith('/') ? inPath : process.cwd() + '/' + inPath)

// Descobre o WebSocket de um alvo do tipo "page" (suporta o domínio Page.*),
// não o endpoint do browser (que só tem Target.*).
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/list')
      const list = await r.json()
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('Chrome DevTools (alvo page) não respondeu na 9222')
}

const footer = `
<div style="font-family:'DejaVu Sans',Arial,sans-serif;font-size:8px;color:#7a8694;width:100%;
            padding:4px 17mm 0;margin:0 0mm;border-top:0.6px solid #d7dee5;
            display:flex;justify-content:space-between;align-items:center;">
  <span style="color:#9aa6b3">Softagon SIGAD — Artigo técnico</span>
  <span style="font-weight:700;color:#566370">Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  <span style="color:#9aa6b3">softagonsistemas.github.io/sigad-download</span>
</div>`
const header = `<div></div>`

const ws = new WebSocket(await wsUrl())
let id = 0
const pending = new Map()
function cmd(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
const loadWaiters = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  } else if (m.method === 'Page.loadEventFired') {
    loadWaiters.splice(0).forEach(fn => fn())
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

await cmd('Page.enable')
const loaded = new Promise(r => loadWaiters.push(r))
await cmd('Page.navigate', { url: fileUrl })
await loaded
await new Promise(r => setTimeout(r, 400)) // assenta fontes/layout

const { data } = await cmd('Page.printToPDF', {
  paperWidth: 8.27, paperHeight: 11.69,          // A4
  marginTop: 0.55, marginBottom: 0.62,           // polegadas (espaço p/ cabeçalho/rodapé)
  marginLeft: 0.67, marginRight: 0.67,           // ~17mm — alinha com o padding do rodapé
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: header,
  footerTemplate: footer,
  preferCSSPageSize: false
})
await Bun.write(outPath, Buffer.from(data, 'base64'))
ws.close()
console.log('PDF gravado:', outPath)
process.exit(0)
