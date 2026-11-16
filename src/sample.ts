/** A small multi-page PDF used to try the page turn before any files are imported. */
export function makeSamplePdf(): Blob {
  const pages = [
    { rgb: '0.16 0.27 0.42', label: '1', name: 'One' },
    { rgb: '0.58 0.30 0.18', label: '2', name: 'Two' },
    { rgb: '0.20 0.40 0.30', label: '3', name: 'Three' },
    { rgb: '0.62 0.48 0.18', label: '4', name: 'Four' },
    { rgb: '0.36 0.22 0.40', label: '5', name: 'Five' },
    { rgb: '0.22 0.28 0.32', label: '6', name: 'Six' },
  ];
  const bodies = pages.map(
    (page) =>
      `${page.rgb} rg\n0 0 612 792 re f\n0.86 0.22 0.18 rg\n0 742 84 50 re f\n0.98 0.96 0.92 rg\nBT\n/F1 26 Tf\n40 640 Td\n(PAGE ${page.label}) Tj\nET\nBT\n/F1 72 Tf\n48 390 Td\n(${page.name}) Tj\nET\n`,
  );

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  const obj = (body: string) => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };

  const kids = bodies.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj(`<< /Type /Pages /Count ${bodies.length} /Kids [${kids}] >>`);
  obj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  bodies.forEach((body, i) => {
    const contentId = 5 + i * 2;
    obj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    obj(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  });

  const xrefAt = out.length;
  const size = offsets.length + 1;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new Blob([out], { type: 'application/pdf' });
}
