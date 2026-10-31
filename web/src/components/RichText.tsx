import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Profile } from '../types';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

const skipped = new Set(['code', 'inlineCode', 'link', 'definition', 'html']);

function planetNodes(value: string): MarkdownNode[] {
  const pattern = /\[\[planet:([^|\]]+)\|([^\]]+)\]\]/g;
  const nodes: MarkdownNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > last) nodes.push({ type: 'text', value: value.slice(last, match.index) });
    nodes.push({ type: 'link', url: `planet:${match[1]}`, children: [{ type: 'text', value: match[2] }] });
    last = pattern.lastIndex;
  }
  if (!nodes.length) return [{ type: 'text', value }];
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
  return nodes;
}

function visit(node: MarkdownNode) {
  if (!node.children || skipped.has(node.type)) return;
  node.children = node.children.flatMap(child => {
    if (child.type === 'text' && typeof child.value === 'string') return planetNodes(child.value);
    visit(child);
    return [child];
  });
  node.children.forEach((child, index) => {
    const previous = node.children?.[index - 1];
    if (child.type === 'link' && child.url?.startsWith('profile:') && previous?.type === 'text' && previous.value?.endsWith('@')) previous.value = previous.value.slice(0, -1);
  });
}

const remarkAstrologyTokens = () => (tree: unknown) => visit(tree as MarkdownNode);

export function RichText({ text, profiles, onProfile, onPlanet }: { text: string; profiles: Profile[]; onProfile: (p: Profile) => void; onPlanet: (id: string) => void }) {
  return <div className="markdown"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkAstrologyTokens]}
    urlTransform={url => /^(?:profile|planet):/.test(url) ? url : defaultUrlTransform(url)}
    components={{
      a({ href, children }) {
        if (href?.startsWith('profile:')) {
          const profile = profiles.find(item => item.id === href.slice(8));
          return profile ? <button type="button" className="inline-profile" style={{ color: profile.color }} onClick={() => onProfile(profile)}>{profile.avatar || '✦'} {children}</button> : <>{children}</>;
        }
        if (href?.startsWith('planet:')) return <button type="button" className="planet-link" onClick={() => onPlanet(href.slice(7))}>{children}</button>;
        const external = /^https?:\/\//i.test(href || '');
        return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{children}</a>;
      },
      table({ children }) { return <div className="markdown-table"><table>{children}</table></div>; },
    }}
  >{text}</ReactMarkdown></div>;
}
