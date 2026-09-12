import { BadRequestException, Injectable } from '@nestjs/common';
import { t, type Locale } from '@jecks/shared';
import {
  renderInvoices,
  renderPackingSlips,
  type InvoiceData,
  type OrderDocumentLine,
  type PackingSlipData,
} from '../../common/pdf/order-documents.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Invoices and packing slips — PRD F-AD-36.
 *
 * One order or fifty: the batch is the normal case, because an owner confirms the
 * morning's orders and prints them in one go rather than opening twenty tabs. So both
 * endpoints take a list and the single-order route is a list of one.
 *
 * The shop's own details come from Settings rather than from a constant, because the
 * trade register and tax identifiers are what make the document an invoice here and
 * they differ per shop.
 */

const DOCUMENT_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
} as const;

@Injectable()
export class OrderDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async invoices(orderIds: string[]): Promise<Buffer> {
    const orders = await this.load(orderIds);
    const shop = await this.shop();
    const printedAt = new Date();

    return renderInvoices(
      orders.map((order) => ({
        orderNumber: order.number,
        placedAt: order.createdAt,
        ...shop,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        address: order.address,
        communeName: order.communeName,
        wilayaName: order.wilayaName,
        lines: order.items.map(toLine),
        subtotalMinor: order.itemsSubtotal,
        discountMinor: order.discountTotal,
        shippingMinor: order.shippingTotal,
        totalMinor: order.total,
        // What is still owed, not what the order is worth: a partly paid order shows
        // the balance, which is the figure the driver collects.
        dueMinor: max(order.total - order.paidTotal, 0n),
        paymentLabel:
          order.paymentStatus === 'PAID'
            ? 'Payée'
            : order.paymentMethod === 'COD'
              ? 'Paiement à la livraison'
              : 'Paiement en ligne',
        isPaid: order.paymentStatus === 'PAID',
        printedAt,
      })) satisfies InvoiceData[],
    );
  }

  async packingSlips(orderIds: string[]): Promise<Buffer> {
    const orders = await this.load(orderIds);
    const shopName = await this.settings.get<string>('store.name', "Jeck's");
    const printedAt = new Date();

    return renderPackingSlips(
      orders.map((order) => ({
        orderNumber: order.number,
        placedAt: order.createdAt,
        shopName,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        address: order.address,
        communeName: order.communeName,
        wilayaName: order.wilayaName,
        isStopDesk: order.deliveryType === 'STOP_DESK',
        pickupPointName: order.pickupPointName,
        lines: order.items.map(toLine),
        note: order.note,
        printedAt,
      })) satisfies PackingSlipData[],
    );
  }

  /**
   * Loads the orders, in the order the caller asked for them.
   *
   * Prisma returns rows in its own order, and a batch print that comes back shuffled
   * makes the stack of paper impossible to match against the screen.
   */
  private async load(orderIds: string[]) {
    const ids = [...new Set(orderIds.filter(Boolean))];

    if (ids.length === 0) {
      throw new BadRequestException({
        code: 'NO_ORDERS',
        message: 'Sélectionnez au moins une commande.',
      });
    }

    if (ids.length > 200) {
      // A hundred pages is already a long wait on a shop's printer.
      throw new BadRequestException({
        code: 'TOO_MANY_ORDERS',
        message: 'Maximum 200 commandes par impression.',
      });
    }

    const rows = await this.prisma.order.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: DOCUMENT_INCLUDE,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (ordered.length === 0) {
      throw new BadRequestException({
        code: 'NO_ORDERS',
        message: 'Aucune de ces commandes n’existe.',
      });
    }

    return ordered;
  }

  /** The shop's identity, as it appears on a document. */
  private async shop() {
    const [name, legalName, address, phones, email, rc, nif, art] = await Promise.all([
      this.settings.get<string>('store.name', "Jeck's"),
      this.settings.get<string>('store.legal_name', ''),
      this.settings.get<string>('store.address', ''),
      this.settings.get<string[]>('store.phones', []),
      this.settings.get<string>('store.email', ''),
      this.settings.get<string>('store.rc', ''),
      this.settings.get<string>('store.nif', ''),
      this.settings.get<string>('store.art', ''),
    ]);

    return {
      // An invoice names the legal entity when there is one; the shopfront name is what
      // the customer recognises, so it is the fallback rather than the other way round.
      shopName: blank(legalName) ?? name,
      shopAddress: blank(address),
      shopPhone: phones[0] ?? null,
      shopEmail: blank(email),
      shopRc: blank(rc),
      shopNif: blank(nif),
      shopArt: blank(art),
    };
  }
}

function toLine(item: {
  productName: unknown;
  variantName: string | null;
  sku: string;
  quantity: number;
  unitPrice: bigint;
  lineTotal: bigint;
}): OrderDocumentLine {
  return {
    // The name is stored translated and snapshotted at the time of the order, so an
    // invoice reprinted a year later still says what was actually sold.
    name: t(item.productName as Parameters<typeof t>[0], 'fr' as Locale) || 'Article',
    variantLabel: item.variantName,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceMinor: item.unitPrice,
    totalMinor: item.lineTotal,
  };
}

function blank(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
