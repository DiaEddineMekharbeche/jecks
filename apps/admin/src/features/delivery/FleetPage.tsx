import { VEHICLE_KINDS, type DriverDto, type VehicleDto } from '@jecks/shared';
import {
  Badge,
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
  Textarea,
  cn,
  notify,
} from '@jecks/ui';
import { useQuery } from '@tanstack/react-query';
import { Car, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api';
import { formatDa, message } from '@/lib/errors';
import * as delivery from './api';
import { VEHICLE_KIND_LABELS } from './labels';

/**
 * Drivers and vehicles — PRD F-AD-62.
 *
 * A driver card shows what the office actually asks about them: are they out right now,
 * how often they get a parcel through the door, and how much of our cash they are
 * carrying.
 */
export function FleetPage() {
  const [driverDialog, setDriverDialog] = useState<DriverDto | 'new' | null>(null);
  const [vehicleDialog, setVehicleDialog] = useState<VehicleDto | 'new' | null>(null);

  const drivers = useQuery({ queryKey: ['admin', 'drivers'], queryFn: delivery.listDrivers });
  const vehicles = useQuery({ queryKey: ['admin', 'vehicles'], queryFn: delivery.listVehicles });

  async function removeDriver(driver: DriverDto) {
    if (!window.confirm(`Retirer ${driver.fullName} de la flotte ?`)) return;
    try {
      await delivery.deleteDriver(driver.id);
      notify.success('Chauffeur retiré');
      void drivers.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  async function removeVehicle(vehicle: VehicleDto) {
    if (!window.confirm(`Retirer ${vehicle.label} ?`)) return;
    try {
      await delivery.deleteVehicle(vehicle.id);
      notify.success('Véhicule retiré');
      void vehicles.refetch();
    } catch (error) {
      notify.error(message(error, 'La suppression a échoué'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Flotte"
        description="Les chauffeurs, leurs véhicules, et l’argent qu’ils ont en main."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-brass" />
            Chauffeurs
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setDriverDialog('new')}>
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {drivers.isLoading ? (
            <Skeleton className="m-4 h-24" label="Chargement des chauffeurs" />
          ) : (drivers.data ?? []).length === 0 ? (
            <EmptyState
              className="border-0"
              title="Aucun chauffeur"
              description="Un chauffeur est un compte du personnel avec le rôle correspondant."
              action={
                <Button size="sm" onClick={() => setDriverDialog('new')}>
                  <Plus className="h-4 w-4" />
                  Ajouter un chauffeur
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {drivers.data!.map((driver) => {
                const attempts = driver.deliveredCount + driver.failedCount;
                const rate = attempts === 0 ? null : Math.round((driver.deliveredCount / attempts) * 100);

                return (
                  <li key={driver.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-ink">{driver.fullName}</p>
                        {!driver.active ? <Badge tone="neutral">Inactif</Badge> : null}
                        {driver.openRunId ? (
                          <Link
                            to={`/delivery/runs/${driver.openRunId}`}
                            className="text-xs text-brass hover:underline"
                          >
                            en tournée
                          </Link>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted">
                        {driver.phone}
                        {driver.wilayaName ? ` · ${driver.wilayaName}` : ''}
                        {driver.licenseNo ? ` · permis ${driver.licenseNo}` : ''}
                      </p>
                    </div>

                    <dl className="flex items-center gap-6 text-sm">
                      <div className="text-end">
                        <dt className="text-[11px] uppercase tracking-wider text-muted">Tournées</dt>
                        <dd className="tabular-nums">{driver.runCount}</dd>
                      </div>
                      <div className="text-end">
                        <dt className="text-[11px] uppercase tracking-wider text-muted">Réussite</dt>
                        <dd
                          className={cn(
                            'tabular-nums',
                            rate !== null && rate < 70 && 'text-warning',
                          )}
                        >
                          {rate === null ? '—' : `${rate} %`}
                        </dd>
                      </div>
                      <div className="text-end">
                        <dt className="text-[11px] uppercase tracking-wider text-muted">En main</dt>
                        <dd
                          className={cn(
                            'tabular-nums',
                            BigInt(driver.cashOnHandMinor) > 0n && 'text-warning',
                          )}
                        >
                          {formatDa(driver.cashOnHandMinor)}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex items-center gap-1">
                      <a
                        href={`tel:${driver.phone}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-elevated hover:text-ink"
                        aria-label={`Appeler ${driver.fullName}`}
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                      <Button variant="ghost" size="sm" onClick={() => setDriverDialog(driver)}>
                        Modifier
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Retirer ${driver.fullName}`}
                        onClick={() => void removeDriver(driver)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Car className="h-4 w-4 text-brass" />
            Véhicules
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setVehicleDialog('new')}>
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {vehicles.isLoading ? (
            <Skeleton className="m-4 h-24" label="Chargement des véhicules" />
          ) : (vehicles.data ?? []).length === 0 ? (
            <EmptyState
              className="border-0"
              title="Aucun véhicule"
              description="Un véhicule est facultatif : une tournée peut se faire sans."
            />
          ) : (
            <ul className="divide-y divide-line">
              {vehicles.data!.map((vehicle) => (
                <li key={vehicle.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-ink">{vehicle.label}</p>
                      {!vehicle.active ? <Badge tone="neutral">Retiré</Badge> : null}
                    </div>
                    <p className="truncate font-mono text-xs text-muted">{vehicle.plate}</p>
                  </div>
                  <span className="text-sm text-muted">
                    {VEHICLE_KIND_LABELS[vehicle.kind] ?? vehicle.kind}
                    {vehicle.capacityKg > 0 ? ` · ${vehicle.capacityKg} kg` : ''}
                  </span>
                  <span className="text-sm tabular-nums text-muted">{vehicle.runCount} tournée(s)</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setVehicleDialog(vehicle)}>
                      Modifier
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Retirer ${vehicle.label}`}
                      onClick={() => void removeVehicle(vehicle)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {driverDialog ? (
        <DriverDialog
          driver={driverDialog === 'new' ? null : driverDialog}
          onClose={() => setDriverDialog(null)}
          onSaved={() => {
            setDriverDialog(null);
            void drivers.refetch();
          }}
        />
      ) : null}

      {vehicleDialog ? (
        <VehicleDialog
          vehicle={vehicleDialog === 'new' ? null : vehicleDialog}
          onClose={() => setVehicleDialog(null)}
          onSaved={() => {
            setVehicleDialog(null);
            void vehicles.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function DriverDialog({
  driver,
  onClose,
  onSaved,
}: {
  driver: DriverDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(driver?.fullName ?? '');
  const [email, setEmail] = useState(driver?.email ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [wilayaCode, setWilayaCode] = useState(driver?.wilayaCode ? String(driver.wilayaCode) : '');
  const [licenseNo, setLicenseNo] = useState(driver?.licenseNo ?? '');
  const [active, setActive] = useState(driver?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim(),
        wilayaCode: wilayaCode ? Number(wilayaCode) : null,
        licenseNo: licenseNo.trim() || null,
        active,
      };

      if (driver) await delivery.updateDriver(driver.id, payload);
      else await delivery.createDriver(payload);

      notify.success(driver ? 'Chauffeur mis à jour' : 'Chauffeur ajouté');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{driver ? driver.fullName : 'Nouveau chauffeur'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Nom complet" required error={errors.fullName}>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </Field>

          <Field
            label="Téléphone"
            required
            hint="Sert aussi à se connecter : le chauffeur reçoit un code par SMS."
            error={errors.phone}
          >
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0551 23 45 67"
            />
          </Field>

          <Field label="E-mail" error={errors.email}>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Wilaya de rattachement">
              <Select
                value={wilayaCode}
                onValueChange={setWilayaCode}
                options={[
                  { value: '', label: 'Aucune' },
                  ...Array.from({ length: 58 }, (_, index) => ({
                    value: String(index + 1),
                    label: String(index + 1).padStart(2, '0'),
                  })),
                ]}
              />
            </Field>
            <Field label="Numéro de permis">
              <Input value={licenseNo} onChange={(event) => setLicenseNo(event.target.value)} />
            </Field>
          </div>

          <SwitchField label="Actif" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!fullName.trim() || !phone.trim()}
            onClick={() => void submit()}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VehicleDialog({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: VehicleDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plate, setPlate] = useState(vehicle?.plate ?? '');
  const [label, setLabel] = useState(vehicle?.label ?? '');
  const [kind, setKind] = useState<string>(vehicle?.kind ?? 'van');
  const [capacityKg, setCapacityKg] = useState(String(vehicle?.capacityKg ?? 0));
  const [note, setNote] = useState(vehicle?.note ?? '');
  const [active, setActive] = useState(vehicle?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        plate: plate.trim().toUpperCase(),
        label: label.trim(),
        kind,
        capacityKg: Number(capacityKg),
        note: note.trim() || null,
        active,
      };

      if (vehicle) await delivery.updateVehicle(vehicle.id, payload);
      else await delivery.createVehicle(payload);

      notify.success(vehicle ? 'Véhicule mis à jour' : 'Véhicule ajouté');
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) setErrors(error.fieldErrors);
      notify.error(message(error, "L'enregistrement a échoué"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{vehicle ? vehicle.label : 'Nouveau véhicule'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Immatriculation" required error={errors.plate}>
            <Input
              value={plate}
              onChange={(event) => setPlate(event.target.value.toUpperCase())}
              placeholder="16-123-45"
              className="font-mono"
            />
          </Field>

          <Field label="Nom" required error={errors.label}>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Kangoo blanc"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={kind}
                onValueChange={setKind}
                options={VEHICLE_KINDS.map((value) => ({
                  value,
                  label: VEHICLE_KIND_LABELS[value] ?? value,
                }))}
              />
            </Field>
            <Field label="Charge utile" hint="En kilogrammes.">
              <Input
                type="number"
                min={0}
                value={capacityKg}
                onChange={(event) => setCapacityKg(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          <SwitchField label="En service" checked={active} onCheckedChange={setActive} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={!plate.trim() || !label.trim()}
            onClick={() => void submit()}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
