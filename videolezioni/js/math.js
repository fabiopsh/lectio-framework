// KaTeX renderer with standard STEM macros + dynamic course.config.json macro merging

export const MATH_MACROS = {
  "\\x": "\\mathbf{x}",
  "\\w": "\\mathbf{w}",
  "\\y": "\\mathbf{y}",
  "\\dd": "\\mathbf{d}",
  "\\h": "\\mathbf{h}",
  "\\vv": "\\mathbf{#1}",
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\T": "^{T}",
  "\\norm": "\\lVert #1 \\rVert",
  "\\abs": "\\lvert #1 \\rvert",
  "\\E": "\\mathbb{E}",
  "\\sign": "\\operatorname{sign}",
  "\\Var": "\\operatorname{Var}",
  "\\Cov": "\\operatorname{Cov}",
  "\\Bias": "\\operatorname{Bias}",
  "\\Remp": "R_{\\mathrm{emp}}",
  "\\VC": "\\mathrm{VC}",
  "\\net": "\\mathit{net}",
  "\\out": "\\mathit{out}",
  "\\eps": "\\varepsilon"
};

export function registerMathMacros(extraMacros) {
  if (!extraMacros || typeof extraMacros !== "object") return;
  for (const [k, v] of Object.entries(extraMacros)) {
    if (typeof k === "string" && typeof v === "string") {
      MATH_MACROS[k] = v;
    }
  }
}

export function renderSlideMath(container) {
  if (typeof window.renderMathInElement !== "function") {
    return;
  }
  window.renderMathInElement(container, {
    delimiters: [
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false }
    ],
    macros: MATH_MACROS,
    throwOnError: false,
    strict: false,
    trust: (context) => context.command === "\\htmlId" || context.command === "\\htmlClass"
  });
}
