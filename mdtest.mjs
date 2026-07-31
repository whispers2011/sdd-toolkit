import { toMarkdown } from './packages/web/node_modules/mdast-util-to-markdown/index.js';
const tree = { type: 'root', children: [
  { type: 'list', ordered: false, children: [
    { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[ ] Task A' }] }] },
    { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '[X] Task B' }] }] },
  ] },
] };
const out = toMarkdown(tree, { listItemIndent: 'one' });
console.log(JSON.stringify(out));
