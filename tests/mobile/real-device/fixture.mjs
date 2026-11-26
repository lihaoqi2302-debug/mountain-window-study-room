// A deterministic, synthetic six-page fixture; no external font or book contents.
export function makePdf() {
  const pages = Array.from({ length: 6 }, (_, i) => 4 + i * 2)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (const [i, id] of pages.entries()) {
    const [w, h] = i % 2 ? [440, 320] : [320, 440]
    const stream = `0.15 0.35 ${i / 10} rg 25 25 ${w - 50} ${h - 50} re f\n1 1 1 rg BT /F1 24 Tf 55 155 Td (Round 3 test: page ${i + 1}) Tj ET\n`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
  }
  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  }
  const start = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`, 'ascii')
}
