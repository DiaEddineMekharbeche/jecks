import{j as e}from"./jsx-runtime-Z5uAzocK.js";import"./index-pP6CS22B.js";import"./_commonjsHelpers-Cpj98o6Y.js";const N={title:"Foundations/Tokens",parameters:{layout:"fullscreen",docs:{description:{component:`A visual index of the design tokens, so a contributor can see what exists before\r
inventing a new value. Switch the surface in the toolbar to check both palettes.`}}}},u=[{token:"base",note:"Page ground"},{token:"surface",note:"Cards, header"},{token:"elevated",note:"Hover, skeletons"},{token:"line",note:"Borders, dividers"},{token:"ink",note:"Body text"},{token:"muted",note:"Secondary text"},{token:"brass",note:"Accent, 9.68:1 on base"},{token:"brass-soft",note:"Accent hover"},{token:"brass-deep",note:"Accent pressed"},{token:"spark",note:"Secondary accent"},{token:"success",note:"Delivered, in stock"},{token:"warning",note:"Low stock, attention"},{token:"danger",note:"Failed, destructive"},{token:"info",note:"Neutral notice"}],r={render:()=>e.jsxs("div",{className:"p-8",children:[e.jsx("h2",{className:"font-display text-3xl",children:"Colours"}),e.jsxs("p",{className:"mt-2 max-w-prose text-sm text-muted",children:["Defined once in ",e.jsx("code",{children:"tokens.css"})," as RGB triples, which is what lets Tailwind apply opacity (",e.jsx("code",{children:"bg-brass/20"}),") and lets the admin theme editor override them at runtime."]}),e.jsx("div",{className:"mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3",children:u.map(s=>e.jsxs("div",{className:"flex items-center gap-3 rounded-sm border border-line p-3",children:[e.jsx("div",{className:"h-12 w-12 shrink-0 rounded-sm border border-line",style:{backgroundColor:`rgb(var(--jk-${s.token}))`}}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("p",{className:"truncate text-sm font-medium",children:s.token}),e.jsx("p",{className:"truncate text-xs text-muted",children:s.note})]})]},s.token))})]})},a={render:()=>e.jsxs("div",{className:"flex flex-col gap-6 p-8",children:[e.jsxs("div",{children:[e.jsx("p",{className:"eyebrow",children:"Display · Bebas Neue"}),e.jsx("p",{className:"font-display text-display",children:"Casquettes"})]}),e.jsxs("div",{children:[e.jsx("p",{className:"eyebrow",children:"Hero"}),e.jsx("p",{className:"font-display text-hero",children:"Une casquette qui vieillit bien"})]}),e.jsxs("div",{children:[e.jsx("p",{className:"eyebrow",children:"Body · Inter"}),e.jsx("p",{className:"max-w-prose",children:"Façade coton brossé, maille aérée à l’arrière et patch brodé main. La Trucker Atlas garde sa forme après une saison entière."})]}),e.jsxs("div",{dir:"rtl",children:[e.jsx("p",{className:"eyebrow",children:"Arabic · Cairo"}),e.jsx("p",{className:"font-arabic max-w-prose text-lg",children:"قبعات مصممة في الجزائر العاصمة، سلاسل قصيرة، الدفع عند الاستلام في 58 ولاية."})]})]})},t={render:()=>e.jsx("div",{className:"flex flex-wrap items-end gap-4 p-8",children:["xs","sm","DEFAULT","lg","xl"].map(s=>e.jsxs("div",{className:"text-center",children:[e.jsx("div",{className:"h-20 w-20 border border-line bg-surface",style:{borderRadius:`var(--jk-radius-${s==="DEFAULT"?"md":s})`}}),e.jsx("p",{className:"mt-2 text-xs text-muted",children:s})]},s))})};var n,o,i;r.parameters={...r.parameters,docs:{...(n=r.parameters)==null?void 0:n.docs,source:{originalSource:`{
  render: () => <div className="p-8">\r
      <h2 className="font-display text-3xl">Colours</h2>\r
      <p className="mt-2 max-w-prose text-sm text-muted">\r
        Defined once in <code>tokens.css</code> as RGB triples, which is what lets\r
        Tailwind apply opacity (<code>bg-brass/20</code>) and lets the admin theme editor\r
        override them at runtime.\r
      </p>\r
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">\r
        {COLORS.map(entry => <div key={entry.token} className="flex items-center gap-3 rounded-sm border border-line p-3">\r
            <div className="h-12 w-12 shrink-0 rounded-sm border border-line" style={{
          backgroundColor: \`rgb(var(--jk-\${entry.token}))\`
        }} />\r
            <div className="min-w-0">\r
              <p className="truncate text-sm font-medium">{entry.token}</p>\r
              <p className="truncate text-xs text-muted">{entry.note}</p>\r
            </div>\r
          </div>)}\r
      </div>\r
    </div>
}`,...(i=(o=r.parameters)==null?void 0:o.docs)==null?void 0:i.source}}};var d,c,l;a.parameters={...a.parameters,docs:{...(d=a.parameters)==null?void 0:d.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-6 p-8">\r
      <div>\r
        <p className="eyebrow">Display · Bebas Neue</p>\r
        <p className="font-display text-display">Casquettes</p>\r
      </div>\r
      <div>\r
        <p className="eyebrow">Hero</p>\r
        <p className="font-display text-hero">Une casquette qui vieillit bien</p>\r
      </div>\r
      <div>\r
        <p className="eyebrow">Body · Inter</p>\r
        <p className="max-w-prose">\r
          Façade coton brossé, maille aérée à l’arrière et patch brodé main. La Trucker\r
          Atlas garde sa forme après une saison entière.\r
        </p>\r
      </div>\r
      <div dir="rtl">\r
        <p className="eyebrow">Arabic · Cairo</p>\r
        <p className="font-arabic max-w-prose text-lg">\r
          قبعات مصممة في الجزائر العاصمة، سلاسل قصيرة، الدفع عند الاستلام في 58 ولاية.\r
        </p>\r
      </div>\r
    </div>
}`,...(l=(c=a.parameters)==null?void 0:c.docs)==null?void 0:l.source}}};var m,p,x;t.parameters={...t.parameters,docs:{...(m=t.parameters)==null?void 0:m.docs,source:{originalSource:`{
  render: () => <div className="flex flex-wrap items-end gap-4 p-8">\r
      {(['xs', 'sm', 'DEFAULT', 'lg', 'xl'] as const).map(size => <div key={size} className="text-center">\r
          <div className="h-20 w-20 border border-line bg-surface" style={{
        borderRadius: \`var(--jk-radius-\${size === 'DEFAULT' ? 'md' : size})\`
      }} />\r
          <p className="mt-2 text-xs text-muted">{size}</p>\r
        </div>)}\r
    </div>
}`,...(x=(p=t.parameters)==null?void 0:p.docs)==null?void 0:x.source}}};const k=["Colours","Typography","Radii"];export{r as Colours,t as Radii,a as Typography,k as __namedExportsOrder,N as default};
