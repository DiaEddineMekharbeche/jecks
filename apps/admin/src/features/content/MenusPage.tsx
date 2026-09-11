import { t, type MenuDto, type MenuItemDto } from '@jecks/shared';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  SwitchField,
  TranslatedInput,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { message } from '@/lib/errors';
import * as content from './api';

/**
 * Menus — PRD F-AD-90 and F-ST-02.
 *
 * A tree two levels deep, which is what a mega-menu is. An item whose parent was
 * deleted becomes a root rather than disappearing, so a mistake costs a drag rather
 * than a lost link.
 */
export function MenusPage() {
  const [creatingMenu, setCreatingMenu] = useState(false);
  const [editing, setEditing] = useState<
    { menuId: string; item: MenuItemDto | null } | null
  >(null);

  const menus = useQuery({ queryKey: ['admin', 'menus'], queryFn: content.listMenus });

  async function removeItem(itemId: string, label: string) {
    if (!window.confirm(`Retirer « ${label} » ?`)) return;
    try {
      await content.deleteMenuItem(itemId);
      notify.success('Entrée retirée');
      await menus.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  async function removeMenu(menu: MenuDto) {
    if (!window.confirm(`Supprimer le menu « ${t(menu.name, 'fr')} » et toutes ses entrées ?`)) {
      return;
    }
    try {
      await content.deleteMenu(menu.id);
      notify.success('Menu supprimé');
      await menus.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Menus"
        description="La navigation de la boutique, en-tête et pied de page."
        actions={
          <Button size="sm" onClick={() => setCreatingMenu(true)}>
            <Plus className="h-4 w-4" />
            Nouveau menu
          </Button>
        }
      />

      {menus.isLoading ? (
        <Skeleton className="h-64" label="Chargement des menus" />
      ) : (menus.data ?? []).length === 0 ? (
        <EmptyState
          title="Aucun menu"
          description="« header » et « footer » sont les deux que la vitrine cherche."
          action={
            <Button size="sm" onClick={() => setCreatingMenu(true)}>
              <Plus className="h-4 w-4" />
              Nouveau menu
            </Button>
          }
        />
      ) : (
        menus.data!.map((menu) => (
          <Card key={menu.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                {t(menu.name, 'fr')}
                <span className="font-mono text-xs font-normal text-muted">{menu.slug}</span>
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing({ menuId: menu.id, item: null })}
                >
                  <Plus className="h-4 w-4" />
                  Ajouter
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Supprimer le menu"
                  onClick={() => void removeMenu(menu)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {menu.items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">Menu vide.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {menu.items.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      depth={0}
                      onEdit={() => setEditing({ menuId: menu.id, item })}
                      onRemove={() => void removeItem(item.id, t(item.label, 'fr'))}
                      onEditChild={(child) => setEditing({ menuId: menu.id, item: child })}
                      onRemoveChild={(child) =>
                        void removeItem(child.id, t(child.label, 'fr'))
                      }
                    />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))
      )}

      <MenuDialog
        open={creatingMenu}
        onClose={() => setCreatingMenu(false)}
        onSaved={() => {
          setCreatingMenu(false);
          void menus.refetch();
        }}
      />

      {editing ? (
        <MenuItemDialog
          menuId={editing.menuId}
          item={editing.item}
          siblings={
            menus.data?.find((menu) => menu.id === editing.menuId)?.items ?? []
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void menus.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function MenuItemRow({
  item,
  depth,
  onEdit,
  onRemove,
  onEditChild,
  onRemoveChild,
}: {
  item: MenuItemDto;
  depth: number;
  onEdit: () => void;
  onRemove: () => void;
  onEditChild: (child: MenuItemDto) => void;
  onRemoveChild: (child: MenuItemDto) => void;
}) {
  return (
    <>
      <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1" style={{ paddingInlineStart: `${depth * 20}px` }}>
          <p className="flex items-center gap-1.5 font-medium text-ink">
            {t(item.label, 'fr')}
            {item.openInNewTab ? <ExternalLink className="h-3 w-3 text-muted" /> : null}
          </p>
          <p className="truncate font-mono text-xs text-muted">{item.url}</p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Modifier
          </Button>
          <Button variant="ghost" size="sm" aria-label="Retirer" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </li>

      {item.children.map((child) => (
        <MenuItemRow
          key={child.id}
          item={child}
          depth={depth + 1}
          onEdit={() => onEditChild(child)}
          onRemove={() => onRemoveChild(child)}
          onEditChild={onEditChild}
          onRemoveChild={onRemoveChild}
        />
      ))}
    </>
  );
}

function MenuDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState<Partial<Record<string, string>>>({ fr: '' });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await content.createMenu({ slug: slug.trim(), name });
      notify.success('Menu créé');
      onSaved();
    } catch (error) {
      notify.error(message(error, 'La création a échoué'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau menu</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Identifiant" required hint="La vitrine cherche « header » et « footer ».">
            <Input
              value={slug}
              onChange={(event) =>
                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
              }
              className="font-mono"
              placeholder="header"
            />
          </Field>

          <Field label="Nom" required>
            <TranslatedInput value={name} onChange={setName} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!slug.trim() || !name.fr?.trim()}
            onClick={() => void submit()}
          >
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MenuItemDialog({
  menuId,
  item,
  siblings,
  onClose,
  onSaved,
}: {
  menuId: string;
  item: MenuItemDto | null;
  siblings: MenuItemDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState<Partial<Record<string, string>>>(item?.label ?? { fr: '' });
  const [url, setUrl] = useState(item?.url ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? '');
  const [openInNewTab, setOpenInNewTab] = useState(item?.openInNewTab ?? false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        parentId: parentId || null,
        label,
        url: url.trim(),
        imageKey: item?.imageKey ?? null,
        position: item?.position ?? siblings.length,
        openInNewTab,
      };

      if (item) await content.updateMenuItem(item.id, payload);
      else await content.addMenuItem(menuId, payload);

      notify.success(item ? 'Entrée mise à jour' : 'Entrée ajoutée');
      onSaved();
    } catch (error) {
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Modifier l’entrée' : 'Nouvelle entrée'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Libellé" required>
            <TranslatedInput value={label} onChange={setLabel} />
          </Field>

          <Field label="Lien" required hint="Un chemin interne, ou une adresse complète.">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="/collections/nouveautes"
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Sous-entrée de" hint="Deux niveaux au maximum.">
            <Select
              value={parentId}
              onValueChange={setParentId}
              options={[
                { value: '', label: 'Aucune — entrée principale' },
                ...siblings
                  .filter((sibling) => sibling.id !== item?.id)
                  .map((sibling) => ({ value: sibling.id, label: t(sibling.label, 'fr') })),
              ]}
            />
          </Field>

          <SwitchField
            label="Ouvrir dans un nouvel onglet"
            checked={openInNewTab}
            onCheckedChange={setOpenInNewTab}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!label.fr?.trim() || !url.trim()}
            onClick={() => void submit()}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
