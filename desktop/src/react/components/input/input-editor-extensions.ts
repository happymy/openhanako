import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { SkillBadge } from './extensions/skill-badge';

export function createInputEditorExtensions(placeholder: string): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      link: false,
    }),
    Placeholder.configure({ placeholder }),
    SkillBadge,
  ];
}
