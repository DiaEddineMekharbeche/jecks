import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminListQuerySchema,
  cashReconcileSchema,
  courierCredentialsSchema,
  courierInputSchema,
  createShipmentSchema,
  deliveryRunInputSchema,
  driverInputSchema,
  runAssignSchema,
  runReorderSchema,
  settlementGenerateSchema,
  settlementPaySchema,
  shipmentUpdateSchema,
  shippingRateBulkSchema,
  shippingRateInputSchema,
  shippingZoneInputSchema,
  stopUpdateSchema,
  trackingImportSchema,
  vehicleInputSchema,
  type AdminListQuery,
  type CashReconcileInput,
  type CourierCredentialsInput,
  type CourierInput,
  type CreateShipmentInput,
  type DeliveryRunInput,
  type DriverInput,
  type RunAssignInput,
  type RunReorderInput,
  type SettlementGenerateInput,
  type SettlementPayInput,
  type SettlementStatusValue,
  type ShipmentUpdateInput,
  type ShippingRateBulkInput,
  type ShippingRateInput,
  type ShippingZoneInput,
  type StopUpdateInput,
  type TrackingImportInput,
  type VehicleInput,
} from '@jecks/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  Public,
  RawResponse,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators.js';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard.js';
import { AuditEntity, NoAudit } from '../../common/interceptors/audit.interceptor.js';
import { ExportService } from '../../common/list/export.service.js';
import { parseFilters } from '../../common/list/list.helper.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { CashService } from './cash.service.js';
import { CourierSyncService } from './courier-sync.service.js';
import { CouriersAdminService } from './couriers-admin.service.js';
import { DeliveryAnalyticsService } from './delivery-analytics.service.js';
import { FleetService } from './fleet.service.js';
import { RunsService } from './runs.service.js';
import { SettlementsService } from './settlements.service.js';
import { SHIPMENT_EXPORT_COLUMNS, ShipmentsService } from './shipments.service.js';
import { ZonesService } from './zones.service.js';

const actorOf = (user: AuthenticatedUser) => ({ id: user.id, name: user.name });

// --- zones and rates --------------------------------------------------------

@ApiTags('admin/shipping')
@ApiBearerAuth()
@AuditEntity('shipping_zone')
@Controller('admin/shipping/zones')
export class ShippingZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Shipping zones and how many rates each prices' })
  list() {
    return this.zones.listZones();
  }

  @Post()
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Create a zone' })
  create(@Body(zod(shippingZoneInputSchema)) body: ShippingZoneInput) {
    return this.zones.createZone(body);
  }

  @Patch(':id')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Update a zone' })
  update(@Param('id') id: string, @Body(zod(shippingZoneInputSchema)) body: ShippingZoneInput) {
    return this.zones.updateZone(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Delete a zone that prices nothing' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.zones.removeZone(id);
  }
}

@ApiTags('admin/shipping')
@ApiBearerAuth()
@AuditEntity('shipping_rate')
@Controller('admin/shipping/rates')
export class ShippingRatesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Rates, optionally for one zone or courier' })
  list(@Query('zoneId') zoneId?: string, @Query('courierId') courierId?: string) {
    return this.zones.listRates({ zoneId, courierId });
  }

  @Get('matrix')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Every wilaya with its home and stop-desk price' })
  matrix(@Query('courierId') courierId?: string) {
    return this.zones.matrix(courierId);
  }

  @Post()
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Create a rate' })
  create(@Body(zod(shippingRateInputSchema)) body: ShippingRateInput) {
    return this.zones.createRate(body);
  }

  @Post('bulk')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Write many matrix cells in one transaction' })
  bulk(@Body(zod(shippingRateBulkSchema)) body: ShippingRateBulkInput) {
    return this.zones.bulkUpsert(body);
  }

  @Patch(':id')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Update a rate' })
  update(@Param('id') id: string, @Body(zod(shippingRateInputSchema)) body: ShippingRateInput) {
    return this.zones.updateRate(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Delete a rate, unless it is the last one serving a wilaya' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.zones.removeRate(id);
  }
}

// --- couriers ---------------------------------------------------------------

@ApiTags('admin/couriers')
@ApiBearerAuth()
@AuditEntity('courier')
@Controller('admin/couriers')
export class CouriersController {
  constructor(private readonly couriers: CouriersAdminService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Couriers, whether they are usable, and the cash they hold' })
  list() {
    return this.couriers.list();
  }

  @Get('providers')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Adapters and the credential fields each one needs' })
  providers() {
    return this.couriers.credentialFields();
  }

  @Get(':id')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'One courier' })
  get(@Param('id') id: string) {
    return this.couriers.get(id);
  }

  @Post()
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Add a courier' })
  create(@Body(zod(courierInputSchema)) body: CourierInput) {
    return this.couriers.create(body);
  }

  @Patch(':id')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Update a courier' })
  update(@Param('id') id: string, @Body(zod(courierInputSchema)) body: CourierInput) {
    return this.couriers.update(id, body);
  }

  /**
   * Credentials are write-only. They go in encrypted and never come back out, which is
   * why this returns the courier rather than what was stored.
   */
  @Post(':id/credentials')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Store courier credentials, encrypted at rest' })
  credentials(
    @Param('id') id: string,
    @Body(zod(courierCredentialsSchema)) body: CourierCredentialsInput,
  ) {
    return this.couriers.saveCredentials(id, body.values);
  }

  @Post(':id/test')
  @NoAudit()
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Check the courier answers, without creating a parcel' })
  test(@Param('id') id: string) {
    return this.couriers.testConnection(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Remove a courier, or deactivate one that has carried parcels' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.couriers.remove(id);
  }
}

// --- shipments --------------------------------------------------------------

@ApiTags('admin/shipments')
@ApiBearerAuth()
@AuditEntity('shipment')
@Controller('admin/shipments')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  @RawResponse()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Shipments with tracking, cost and cash to collect' })
  @ApiQuery({ name: 'filter[status]', required: false, isArray: true })
  async list(
    @Query(zod(adminListQuerySchema)) query: AdminListQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const filters = parseFilters(request.query as Record<string, unknown>);

    if (query.format) {
      const rows = await this.shipments.listForExport(query, filters);
      await this.exporter.stream(response, query.format, 'shipments', SHIPMENT_EXPORT_COLUMNS, rows);
      return;
    }

    response.json(await this.shipments.list(query, filters));
  }

  @Get('counts')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Row counts per status, for the tabs' })
  counts() {
    return this.shipments.counts();
  }

  @Get(':id')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'One shipment with its courier events' })
  get(@Param('id') id: string) {
    return this.shipments.get(id);
  }

  @Post()
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Hand orders to a courier or a driver; failures are per order' })
  create(
    @Body(zod(createShipmentSchema)) body: CreateShipmentInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shipments.create(body, actorOf(user));
  }

  /**
   * Labels stream as a PDF, so the browser can print them straight away.
   *
   * `@RawResponse` because a base64 blob inside the envelope would double the size and
   * still need decoding before it could reach a printer.
   */
  @Post('labels')
  @RawResponse()
  @NoAudit()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'A printable label sheet for a batch of shipments' })
  async labels(@Body('shipmentIds') shipmentIds: string[], @Res() response: Response): Promise<void> {
    const pdf = await this.shipments.labels(shipmentIds ?? []);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', 'attachment; filename="etiquettes.pdf"');
    response.end(pdf);
  }

  @Post('import-tracking')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Apply the tracking numbers a manual courier sent back' })
  importTracking(
    @Body(zod(trackingImportSchema)) body: TrackingImportInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shipments.importTracking(body, actorOf(user));
  }

  @Patch(':id')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Correct a tracking number or a cost' })
  update(@Param('id') id: string, @Body(zod(shipmentUpdateSchema)) body: ShipmentUpdateInput) {
    return this.shipments.update(id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Cancel a parcel that has not been delivered' })
  cancel(@Param('id') id: string) {
    return this.shipments.cancel(id);
  }
}

// --- fleet ------------------------------------------------------------------

@ApiTags('admin/fleet')
@ApiBearerAuth()
@AuditEntity('vehicle')
@Controller('admin/vehicles')
export class VehiclesController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Vehicles and how many runs each has done' })
  list() {
    return this.fleet.listVehicles();
  }

  @Post()
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Add a vehicle' })
  create(@Body(zod(vehicleInputSchema)) body: VehicleInput) {
    return this.fleet.createVehicle(body);
  }

  @Patch(':id')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Update a vehicle' })
  update(@Param('id') id: string, @Body(zod(vehicleInputSchema)) body: VehicleInput) {
    return this.fleet.updateVehicle(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Retire a vehicle' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.fleet.removeVehicle(id);
  }
}

@ApiTags('admin/fleet')
@ApiBearerAuth()
@AuditEntity('driver')
@Controller('admin/drivers')
export class DriversController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Drivers with their runs, success and cash on hand' })
  list() {
    return this.fleet.listDrivers();
  }

  @Get(':id')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'One driver' })
  get(@Param('id') id: string) {
    return this.fleet.getDriver(id);
  }

  @Post()
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Add a driver, creating their account if needed' })
  create(@Body(zod(driverInputSchema)) body: DriverInput) {
    return this.fleet.createDriver(body);
  }

  @Patch(':id')
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Update a driver' })
  update(@Param('id') id: string, @Body(zod(driverInputSchema)) body: DriverInput) {
    return this.fleet.updateDriver(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('delivery.write')
  @ApiOperation({ summary: 'Remove a driver who has no run open' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.fleet.removeDriver(id);
  }
}

// --- runs -------------------------------------------------------------------

@ApiTags('admin/delivery-runs')
@ApiBearerAuth()
@AuditEntity('delivery_run')
@Controller('admin/delivery-runs')
export class DeliveryRunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly fleet: FleetService,
  ) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Runs for a day, a driver, or a status' })
  list(
    @Query('date') date?: string,
    @Query('driverId') driverId?: string,
    @Query('status') status?: string,
  ) {
    return this.runs.list({
      date: date ? new Date(date) : undefined,
      driverId,
      status: status ? status.split(',') : undefined,
    });
  }

  @Get('assignable')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Orders that could be loaded onto a run' })
  assignable(@Query('date') date?: string, @Query('wilayaCode') wilayaCode?: string) {
    return this.fleet.assignableOrders(
      date ? new Date(date) : new Date(),
      wilayaCode ? Number(wilayaCode) : undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'One run with its stops in driving order' })
  get(@Param('id') id: string) {
    return this.runs.get(id);
  }

  @Get(':id/manifest')
  @RawResponse()
  @NoAudit()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'The manifest the driver signs' })
  async manifest(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const { pdf, filename } = await this.runs.manifest(id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.end(pdf);
  }

  @Post()
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Plan a run for a date, a driver and a vehicle' })
  create(@Body(zod(deliveryRunInputSchema)) body: DeliveryRunInput) {
    return this.runs.create(body);
  }

  @Patch(':id')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Change the date, driver or vehicle' })
  update(@Param('id') id: string, @Body(zod(deliveryRunInputSchema)) body: DeliveryRunInput) {
    return this.runs.update(id, body);
  }

  @Post(':id/orders')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Add orders to the run' })
  assign(@Param('id') id: string, @Body(zod(runAssignSchema)) body: RunAssignInput) {
    return this.runs.assign(id, body);
  }

  @Delete(':id/stops/:stopId')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Take a stop off the run' })
  unassign(@Param('id') id: string, @Param('stopId') stopId: string) {
    return this.runs.unassign(id, stopId);
  }

  @Post(':id/reorder')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Apply a hand-dragged order' })
  reorder(@Param('id') id: string, @Body(zod(runReorderSchema)) body: RunReorderInput) {
    return this.runs.reorder(id, body);
  }

  @Post(':id/optimise')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Order the stops by distance from the warehouse' })
  optimise(@Param('id') id: string) {
    return this.runs.optimise(id);
  }

  @Post(':id/start')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Mark the run as under way' })
  start(@Param('id') id: string) {
    return this.runs.start(id);
  }

  @Post(':id/complete')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Close the run and total the cash' })
  complete(@Param('id') id: string) {
    return this.runs.complete(id);
  }

  @Post(':id/cancel')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Cancel a run that has not finished' })
  cancel(@Param('id') id: string) {
    return this.runs.cancel(id);
  }

  @Patch(':id/stops/:stopId')
  @RequirePermissions('delivery.dispatch')
  @ApiOperation({ summary: 'Record what happened at a door' })
  updateStop(
    @Param('id') id: string,
    @Param('stopId') stopId: string,
    @Body(zod(stopUpdateSchema)) body: StopUpdateInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.updateStop(id, stopId, body, actorOf(user));
  }
}

/**
 * What a driver's phone talks to — PRD F-AD-63.
 *
 * Every route resolves the driver from the session rather than taking an id, so a driver
 * cannot read or close another driver's run by changing a number in a URL. That is
 * acceptance criterion 6, and it is enforced here rather than in the client.
 */
@ApiTags('driver')
@ApiBearerAuth()
@AuditEntity('delivery_run')
@Controller('driver')
export class DriverController {
  constructor(
    private readonly runs: RunsService,
    private readonly fleet: FleetService,
  ) {}

  @Get('run')
  @RequirePermissions('delivery.own_runs')
  @ApiOperation({ summary: "The signed-in driver's current run" })
  async run(@CurrentUser() user: AuthenticatedUser) {
    const driver = await this.requireDriver(user);
    return this.runs.todayFor(driver.id);
  }

  @Get('runs/:id')
  @RequirePermissions('delivery.own_runs')
  @ApiOperation({ summary: 'One of their own runs' })
  async get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const driver = await this.requireDriver(user);
    return this.runs.get(id, driver.id);
  }

  @Patch('runs/:id/stops/:stopId')
  @RequirePermissions('delivery.own_runs')
  @ApiOperation({ summary: 'Report a delivery, a failure or a reschedule' })
  async updateStop(
    @Param('id') id: string,
    @Param('stopId') stopId: string,
    @Body(zod(stopUpdateSchema)) body: StopUpdateInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const driver = await this.requireDriver(user);
    return this.runs.updateStop(id, stopId, body, actorOf(user), driver.id);
  }

  private async requireDriver(user: AuthenticatedUser): Promise<{ id: string }> {
    const driver = await this.fleet.driverForUser(user.id);
    if (!driver) {
      throw new ForbiddenException({
        code: 'NOT_A_DRIVER',
        message: 'This account is not attached to a driver',
      });
    }
    return driver;
  }
}

// --- cash and settlements ---------------------------------------------------

@ApiTags('admin/cash')
@ApiBearerAuth()
@AuditEntity('cod_collection')
@Controller('admin/cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('daily')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Expected against collected cash for a day, per holder' })
  daily(@Query('date') date?: string) {
    return this.cash.daily(date ? new Date(date) : new Date());
  }

  @Get('outstanding')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'What one driver or courier is still holding' })
  outstanding(@Query('kind') kind: 'driver' | 'courier', @Query('id') id: string) {
    return this.cash.outstandingFor(kind === 'courier' ? 'courier' : 'driver', id);
  }

  @Post('reconcile')
  @RequirePermissions('delivery.settle')
  @ApiOperation({ summary: 'Count cash in' })
  reconcile(@Body(zod(cashReconcileSchema)) body: CashReconcileInput) {
    return this.cash.reconcile(body);
  }
}

@ApiTags('admin/settlements')
@ApiBearerAuth()
@AuditEntity('courier_settlement')
@Controller('admin/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Settlements, newest period first' })
  list(@Query('courierId') courierId?: string, @Query('status') status?: string) {
    return this.settlements.list({ courierId, status: status ? status.split(',') : undefined });
  }

  @Get(':id')
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'One settlement with every line' })
  get(@Param('id') id: string) {
    return this.settlements.get(id);
  }

  @Post()
  @RequirePermissions('delivery.settle')
  @ApiOperation({ summary: 'Build a settlement from delivered, unsettled parcels' })
  generate(@Body(zod(settlementGenerateSchema)) body: SettlementGenerateInput) {
    return this.settlements.generate(body);
  }

  @Post(':id/status')
  @RequirePermissions('delivery.settle')
  @ApiOperation({ summary: 'Mark a settlement sent or disputed' })
  setStatus(@Param('id') id: string, @Body('status') status: SettlementStatusValue) {
    return this.settlements.setStatus(id, status);
  }

  @Post(':id/pay')
  @RequirePermissions('delivery.settle')
  @ApiOperation({ summary: 'Record a payment; any shortfall stays visible' })
  pay(@Param('id') id: string, @Body(zod(settlementPaySchema)) body: SettlementPayInput) {
    return this.settlements.pay(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('delivery.settle')
  @ApiOperation({ summary: 'Delete a settlement nothing has been paid against' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.settlements.remove(id);
  }
}

@ApiTags('admin/delivery')
@ApiBearerAuth()
@Controller('admin/delivery')
export class DeliveryAnalyticsController {
  constructor(private readonly analytics: DeliveryAnalyticsService) {}

  @Get('analytics')
  @NoAudit()
  @RequirePermissions('delivery.read')
  @ApiOperation({ summary: 'Success rate and transit time, per courier and per wilaya' })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 29 * 86_400_000);
    return this.analytics.summary(start, end);
  }
}

/**
 * What the worker calls, on the clock — PRD F-AD-61.
 *
 * Guarded by a shared token rather than a session: there is no person behind a polling
 * job. It is deliberately the only internal route in the delivery module, and it does
 * nothing a person could not also trigger from the couriers screen.
 */
@ApiTags('internal')
@Controller('internal/couriers')
export class CourierSyncController {
  constructor(private readonly sync: CourierSyncService) {}

  @Public()
  @NoAudit()
  @UseGuards(InternalTokenGuard)
  @Post('sync')
  @ApiExcludeEndpoint()
  poll(@Body('limit') limit?: number) {
    return this.sync.syncAll(limit && limit > 0 ? Math.min(limit, 500) : 200);
  }
}
