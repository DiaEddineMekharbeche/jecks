'use client';

import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { isSafeUrl } from './url-safety';

/**
 * The editor for a page body or a product description — PRD Section 2.1 and F-AD-90.
 *
 * These fields are rendered on the storefront as HTML. Until this existed they were
 * typed as HTML, by hand, into a textarea — which asked a shop owner to know what an
 * `<h2>` is in order to write a delivery policy.
 *
 * The toolbar is deliberately short. Everything on it survives the server's sanitiser
 * (D102); anything that would not — arbitrary colours, inline styles, embedded frames —
 * is absent rather than offered and then silently stripped on save, which is the worse
 * failure because the editor shows it working.
 */

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** `rtl` for Arabic: typing Arabic into a left-to-right field is unusable. */
  dir?: 'ltr' | 'rtl';
  lang?: string;
  className?: string;
  id?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  dir = 'ltr',
  lang,
  className,
  id,
}: RichTextEditorProps) {
  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // The sanitiser allows h1–h6; two levels is what a shop page needs, and a
        // toolbar with six heading buttons is a toolbar nobody reads.
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // Matches the sanitiser's scheme list, so a link that looks saved is saved.
        protocols: ['http', 'https', 'mailto', 'tel'],
        HTMLAttributes: { rel: 'noopener noreferrer' },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      // TipTap represents empty as a lone paragraph; storing that would make an empty
      // field look filled to every "is this translated" check.
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        dir,
        ...(lang ? { lang } : {}),
        ...(id ? { id } : {}),
        class: cn(
          'prose-editor min-h-48 w-full px-3 py-2.5 text-sm text-ink outline-none',
          '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-xl',
          '[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:font-display [&_h3]:text-lg',
          '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:ps-5',
          '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:ps-5',
          '[&_blockquote]:my-2 [&_blockquote]:border-s-2 [&_blockquote]:border-brass [&_blockquote]:ps-3',
          '[&_a]:text-brass [&_a]:underline [&_code]:rounded-sm [&_code]:bg-elevated [&_code]:px-1',
          '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-sm',
        ),
      },
    },
    // The admin is a client-rendered SPA; this silences the SSR hydration warning.
    immediatelyRender: false,
  });

  // The parent owns the value. Language tabs swap it underneath a mounted editor, and
  // without this the Arabic tab would keep showing the French text.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    if (value === '' && editor.isEmpty) return;

    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return <div className={cn('h-56 rounded-sm border border-line bg-base', className)} />;
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-sm border border-line bg-base focus-within:border-brass',
        disabled && 'opacity-60',
        className,
      )}
    >
      <Toolbar editor={editor} disabled={disabled} />

      <EditorContent editor={editor} />

      {placeholder && editor.isEmpty ? (
        <p className="pointer-events-none -mt-10 px-3 text-sm text-muted" aria-hidden>
          {placeholder}
        </p>
      ) : null}
    </div>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b border-line bg-elevated/40 px-1.5 py-1"
      role="toolbar"
      aria-label="Mise en forme"
    >
      <ToolButton
        label="Gras"
        active={editor.isActive('bold')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Italique"
        active={editor.isActive('italic')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Barré"
        active={editor.isActive('strike')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="Titre"
        active={editor.isActive('heading', { level: 2 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Sous-titre"
        active={editor.isActive('heading', { level: 3 })}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="Liste à puces"
        active={editor.isActive('bulletList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Liste numérotée"
        active={editor.isActive('orderedList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Citation"
        active={editor.isActive('blockquote')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Code"
        active={editor.isActive('code')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="Lien"
        active={editor.isActive('link')}
        disabled={disabled}
        onClick={() => promptForLink(editor)}
      >
        <Link2 className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Image"
        disabled={disabled}
        onClick={() => promptForImage(editor)}
      >
        <ImageIcon className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        label="Annuler"
        disabled={disabled || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        label="Rétablir"
        disabled={disabled || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  label,
  active = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn('h-7 w-7 p-0', active && 'bg-brass/15 text-brass')}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-line" aria-hidden />;
}

/**
 * Asks for a URL.
 *
 * A prompt rather than a dialog: it is two lines instead of eighty, it is keyboard
 * accessible for free, and the alternative was worth building only if link editing were
 * the common case, which it is not.
 */
function promptForLink(editor: Editor): void {
  const current = (editor.getAttributes('link').href as string | undefined) ?? '';
  const href = window.prompt('Adresse du lien', current);

  if (href === null) return;

  if (href.trim() === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }

  if (!isSafeUrl(href)) {
    window.alert('Seuls les liens http, https, mailto et tel sont acceptés.');
    return;
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
}

function promptForImage(editor: Editor): void {
  const src = window.prompt('Adresse de l’image');
  if (src === null || src.trim() === '') return;

  if (!/^https?:\/\//i.test(src.trim())) {
    window.alert('L’image doit être une adresse http ou https.');
    return;
  }

  const alt = window.prompt('Texte alternatif (pour les lecteurs d’écran)') ?? '';
  editor.chain().focus().setImage({ src: src.trim(), alt }).run();
}

