import React, { useState, useEffect, useMemo, useCallback, Component, ErrorInfo, ReactNode, useRef } from 'react';
import { 
  auth, 
  secondaryAuth,
  db, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut, 
  collection, 
  addDoc, 
  setDoc,
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp, 
  doc, 
  getDoc,
  updateDoc, 
  deleteDoc,
  getDocs,
  writeBatch,
  getDocFromServer,
  documentId,
  limit,
  increment,
  updatePassword,
  runTransaction
} from './firebase';
import { setReadMeterContext } from './readMeter';
import { startReadMeterSync } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import type { Transaction } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { format } from 'date-fns';
import { 
  Ticket as TicketIcon, 
  LogOut, 
  Plus, 
  History, 
  TrendingUp, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  ShieldCheck,
  LayoutDashboard,
  Settings,
  AlertTriangle,
  Printer,
  Download,
  Share2,
  Calendar,
  Camera,
  DollarSign,
  User as UserIcon,
  Lock,
  ChevronRight,
  ChevronDown,
  Trophy,
  Search,
  Sun,
  Moon,
  Bell,
  Cloud,
  CloudOff,
  Menu,
  X,
  Edit2,
  Receipt,
  ToggleLeft,
  ToggleRight,
  Copy,
  Users,
  Banknote,
  Zap,
  ArrowLeftRight,
  MessageCircle,
  Delete,
  PlusCircle,
  Repeat,
  Check,
  RotateCcw,
  Minus,
  Layers,
  Clock,
  FileText,
  Database,
  Wallet,
  ArrowUpRight,
  Flag,
  Star,
  Archive,
  BarChart3,
  ScanQrCode
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';
import QRCode from 'react-qr-code';
import { renderToStaticMarkup } from 'react-dom/server';
import { toPng } from 'html-to-image';
import { TicketReceiptExport } from './components/TicketReceiptExport';
import { BottomNav } from './components/BottomNav';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from 'recharts';

// --- Types ---
interface Bet {
  number: string;
  lottery: string;
  amount: number;
  type: 'CH' | 'PL' | 'BL';
  quantity: number;
  price?: number;
}

const getBetTypeLabel = (type?: string) => {
  const t = String(type || '').trim().toUpperCase();
  if (t.startsWith('B')) return 'BL';
  if (t.startsWith('P')) return 'PL';
  if (t.startsWith('C')) return 'CH';
  return t || '?';
};

const getBetUnitPrice = (bet: Bet) => (
  typeof bet.price === 'number' && bet.price > 0
    ? bet.price
    : (bet.quantity > 0 ? bet.amount / bet.quantity : 0)
);

type StatsReportFilter = 'global' | 'chance' | 'billete' | 'pale';

const statsReportFilterOptions: Array<{ id: StatsReportFilter; label: string }> = [
  { id: 'global', label: 'Todo' },
  { id: 'chance', label: 'Chance' },
  { id: 'billete', label: 'Billete' },
  { id: 'pale', label: 'Palé' }
];

const unifyBets = (bets: Bet[]): Bet[] => {
  const unified: Bet[] = [];
  bets.forEach(bet => {
    const num = (bet.number || '').toString().trim();
    const lot = (bet.lottery || '').toString().trim();
    const type = bet.type;
    
    const existing = unified.find(u => 
      u.number.trim() === num && 
      u.lottery.trim() === lot && 
      u.type === type &&
      (type !== 'CH' || Math.abs(getBetUnitPrice(u) - getBetUnitPrice(bet)) < 0.001)
    );
    
    if (existing) {
      existing.quantity += bet.quantity;
      existing.amount += bet.amount;
    } else {
      unified.push({
        ...bet,
        number: num,
        lottery: lot,
        ...(type === 'CH' ? { price: Number(getBetUnitPrice(bet).toFixed(2)) } : {})
      });
    }
  });
  return unified;
};

interface LotteryTicket {
  id: string;
  bets: Bet[];
  totalAmount: number;
  chancePrice?: number;
  timestamp: any;
  date?: string;
  sellerId: string;
  sellerCode?: string;
  sellerEmail?: string;
  sellerName: string;
  commissionRate: number;
  status: 'active' | 'cancelled' | 'winner';
  customerName?: string;
  sequenceNumber?: string;
  liquidated?: boolean;
  settlementId?: string;
}

interface Lottery {
  id: string;
  name: string;
  drawTime: string;
  active: boolean;
  pricePerUnit?: number;
  closingTime?: string;
  isFourDigits?: boolean;
  allowPale?: boolean;
  allowBillete?: boolean;
  billeteClosingTime?: string;
}

const lotteryAllowsPale = (lot?: Lottery | null) => !!lot && lot.allowPale !== false;
const lotteryAllowsBillete = (lot?: Lottery | null) => !!lot && !!lot.isFourDigits && lot.allowBillete !== false;

const DEFAULT_COMBO_LIMIT = 5;

interface ChancePriceConfig {
  price: number;
  ch1: number;
  ch2: number;
  ch3: number;
}

interface BilletePrizeMultipliers {
  full4: number;
  first3: number;
  last3: number;
  first2: number;
  last2: number;
  last1?: number;
}

interface GlobalSettings {
  id: string;
  palesLimit?: number;
  billetesLimit?: number;
  palesFixedAmounts?: number[];
  billetesFixedAmounts?: number[];
  chancePrices: ChancePriceConfig[];
  palesEnabled: boolean;
  billetesEnabled: boolean;
  pl12Multiplier: number;
  pl13Multiplier: number;
  pl23Multiplier: number;
  nextSellerNumber?: number;
  billeteMultipliers?: {
    p1: BilletePrizeMultipliers;
    p2: BilletePrizeMultipliers;
    p3: BilletePrizeMultipliers;
  };
}

interface PaleSimulationSettings {
  enabled: boolean;
  multiplier: number | null;
}

interface LotteryResult {
  id: string;
  lotteryId: string;
  lotteryName: string;
  date: string;
  firstPrize: string;
  secondPrize: string;
  thirdPrize: string;
  timestamp: any;
}

interface BetPrizeHit {
  prize: number;
  rank: number;
  winningNumber: string;
  matchType?: string;
}

// Un multiplicador en 0 significa "no premia"; solo se usa el valor por defecto si no está configurado.
const prizeMultiplier = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Calcula los premios de una jugada leyendo los multiplicadores de la configuración global.
const evaluateBetPrizes = (bet: { type: string; number: string; amount?: number; quantity?: number }, result: LotteryResult, settings: GlobalSettings): BetPrizeHit[] => {
  const hits: BetPrizeHit[] = [];
  const amount = bet.amount || 0;
  const number = bet.number || '';
  const add = (prize: number, rank: number, winningNumber: string, matchType?: string) => {
    if (prize > 0) hits.push({ prize, rank, winningNumber, matchType });
  };

  if (bet.type === 'CH') {
    const quantity = bet.quantity || 1;
    const pricePerChance = amount / quantity;
    const config = settings.chancePrices?.find(cp => Math.abs(cp.price - pricePerChance) < 0.001);
    if (!config) return hits;
    const last2 = number.slice(-2);
    ([
      [result.firstPrize, config.ch1, 1],
      [result.secondPrize, config.ch2, 2],
      [result.thirdPrize, config.ch3, 3]
    ] as [string, number, number][]).forEach(([winning, mult, rank]) => {
      if (winning && last2 === winning.slice(-2)) add(prizeMultiplier(mult, 0) * quantity, rank, winning);
    });
  } else if (bet.type === 'PL' && settings.palesEnabled) {
    const n1 = number.slice(0, 2);
    const n2 = number.slice(2, 4);
    const r1 = (result.firstPrize || '').slice(-2);
    const r2 = (result.secondPrize || '').slice(-2);
    const r3 = (result.thirdPrize || '').slice(-2);
    const pairs: [string, string, number, number][] = [
      [r1, r2, prizeMultiplier(settings.pl12Multiplier, 1000), 1],
      [r1, r3, prizeMultiplier(settings.pl13Multiplier, 1000), 1],
      [r2, r3, prizeMultiplier(settings.pl23Multiplier, 200), 2]
    ];
    // Un palé paga una sola combinación: la de mayor multiplicador entre las que acierta.
    let best: [string, string, number, number] | null = null;
    pairs.forEach(pair => {
      const [a, b] = pair;
      if (a && b && ((n1 === a && n2 === b) || (n1 === b && n2 === a)) && (!best || pair[2] > best[2])) best = pair;
    });
    if (best) {
      const [a, b, mult, rank] = best as [string, string, number, number];
      add(amount * mult, rank, `${a}-${b}`, 'Palé');
    }
  } else if (bet.type === 'BL' && settings.billetesEnabled) {
    const defaults: BilletePrizeMultipliers = { full4: 2000, first3: 200, last3: 200, first2: 20, last2: 20 };
    const tables = settings.billeteMultipliers;
    ([
      [result.firstPrize, 1, tables?.p1],
      [result.secondPrize, 2, tables?.p2],
      [result.thirdPrize, 3, tables?.p3]
    ] as [string, number, BilletePrizeMultipliers | undefined][]).forEach(([winning, rank, table]) => {
      if (!winning || winning.length !== 4 || number.length !== 4) return;
      const m = (key: 'full4' | 'first3' | 'last3' | 'first2' | 'last2') => prizeMultiplier(table?.[key], defaults[key]);
      // Se paga solo el mayor acierto, en orden: 4 cifras, 3 primeras/últimas, 2 primeras/últimas.
      const tiers: [boolean, number, string][] = [
        [number === winning, m('full4'), '4 Cifras'],
        [number.slice(0, 3) === winning.slice(0, 3), m('first3'), '3 Primeras'],
        [number.slice(1) === winning.slice(1), m('last3'), '3 últimas'],
        [number.slice(0, 2) === winning.slice(0, 2), m('first2'), '2 Primeras'],
        [number.slice(2) === winning.slice(2), m('last2'), '2 últimas']
      ];
      const matched = tiers.find(t => t[0]);
      let payout = matched ? matched[1] : 0;
      let matchType = matched ? matched[2] : undefined;
      const last1 = prizeMultiplier(table?.last1, 0);
      if (last1 > payout && number.charAt(3) === winning.charAt(3)) {
        payout = last1;
        matchType = 'Última cifra';
      }
      add(amount * payout, rank, winning, matchType);
    });
  }

  return hits;
};

const getPale13Simulation = (
  bet: { type: string; number: string; amount?: number },
  result: LotteryResult | undefined,
  settings: GlobalSettings,
  simulation: PaleSimulationSettings | undefined
): { prize: number | null } | null => {
  const multiplier = simulation?.multiplier;
  if (
    !simulation?.enabled ||
    !settings.palesEnabled ||
    prizeMultiplier(settings.pl13Multiplier, 1000) !== 0 ||
    bet.type !== 'PL' ||
    bet.number?.length !== 4 ||
    !result
  ) return null;

  const first = (result.firstPrize || '').slice(-2);
  const third = (result.thirdPrize || '').slice(-2);
  if (first.length !== 2 || third.length !== 2) return null;
  if (!(
    (bet.number.slice(0, 2) === first && bet.number.slice(2, 4) === third) ||
    (bet.number.slice(0, 2) === third && bet.number.slice(2, 4) === first)
  )) return null;

  const prize = typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0
    ? (bet.amount || 0) * multiplier
    : null;
  return { prize };
};

interface UserProfile {
  email: string;
  name: string;
  role: 'ceo' | 'admin' | 'seller' | 'programador';
  commissionRate: number;
  status: 'active' | 'inactive';
  canLiquidate?: boolean;
  currentDebt?: number;
  sessionTimeoutMinutes?: number;
  sellerId?: string;
  preferredChancePrice?: number;
}

interface Settlement {
  id: string;
  userEmail: string;
  date: string;
  totalSales: number;
  totalCommissions: number;
  totalPrizes: number;
  netProfit: number;
  amountPaid: number;
  debtAdded: number;
  previousDebt: number;
  newTotalDebt: number;
  liquidatedBy: string;
  timestamp: any;
  sellerEmail?: string;
  sellerId?: string | null;
  resultadoDia?: number;
  balanceFinal?: number;
  difference?: number;
  net?: number;
}

interface RecoveryTicketRecord {
  rowId: string;
  source: 'tickets' | 'daily_archives';
  archiveDate?: string;
  id: string;
  sellerId?: string;
  sellerCode?: string;
  sellerName?: string;
  sellerEmail?: string;
  timestamp: any;
  status?: string;
  totalAmount?: number;
  bets: Bet[];
  raw: Record<string, any>;
}

type PrinterPaperWidth = '58' | '80';

interface BluetoothPrinterProfile {
  id: string;
  label: string;
  serviceUuid: string;
  characteristicUuid: string;
}

interface BluetoothPrinterConfig {
  deviceId: string;
  deviceName: string;
  deviceAddress?: string;
  profileId: string;
  serviceUuid: string;
  characteristicUuid: string;
  paperWidth: PrinterPaperWidth;
  connectedAt: string;
}

interface NativeBluetoothPrinterDevice {
  name: string;
  address: string;
}

interface NativeBluetoothPrinterPlugin {
  listBondedDevices(): Promise<{ devices: NativeBluetoothPrinterDevice[] }>;
  print(options: { address: string; text: string; qr?: string }): Promise<void>;
  openBluetoothSettings(): Promise<void>;
  requestPermissions(): Promise<Record<string, string>>;
}

const NativeBluetoothPrinter = registerPlugin<NativeBluetoothPrinterPlugin>('BluetoothPrinter');

const BLUETOOTH_PRINTER_STORAGE_KEY = 'chancepro.bluetoothPrinter.v1';
const USER_STATUS_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const USER_STATUS_LAST_CHECK_STORAGE_PREFIX = 'chancepro.userStatusLastCheck.';

const BLUETOOTH_PRINTER_PROFILES: BluetoothPrinterProfile[] = [
  {
    id: 'escpos-18f0',
    label: 'Generica ESC/POS BLE',
    serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb',
    characteristicUuid: '00002af1-0000-1000-8000-00805f9b34fb'
  },
  {
    id: 'serial-ffe0',
    label: 'Serial BLE FFE0/FFE1',
    serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
    characteristicUuid: '0000ffe1-0000-1000-8000-00805f9b34fb'
  },
  {
    id: 'nordic-uart',
    label: 'Nordic UART',
    serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    characteristicUuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
  }
];

const getBluetoothApi = () => (navigator as any).bluetooth || null;

const getSavedBluetoothPrinterConfig = (): BluetoothPrinterConfig | null => {
  try {
    const raw = localStorage.getItem(BLUETOOTH_PRINTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BluetoothPrinterConfig;
  } catch {
    return null;
  }
};

const saveBluetoothPrinterConfig = (config: BluetoothPrinterConfig | null) => {
  if (!config) {
    localStorage.removeItem(BLUETOOTH_PRINTER_STORAGE_KEY);
    return;
  }
  localStorage.setItem(BLUETOOTH_PRINTER_STORAGE_KEY, JSON.stringify(config));
};

const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const getPrinterProfilesToTry = (profileId?: string) => {
  const selected = BLUETOOTH_PRINTER_PROFILES.find(profile => profile.id === profileId);
  return selected
    ? [selected, ...BLUETOOTH_PRINTER_PROFILES.filter(profile => profile.id !== selected.id)]
    : BLUETOOTH_PRINTER_PROFILES;
};

const ensureBluetoothPrinterSupport = () => {
  const bluetooth = getBluetoothApi();
  if (!bluetooth) {
    throw new Error('Este dispositivo o navegador no permite Bluetooth desde la app.');
  }
  if (!window.isSecureContext) {
    throw new Error('Bluetooth requiere abrir la app por HTTPS o localhost.');
  }
  return bluetooth;
};

const getPrinterCharacteristic = async (server: any, profiles: BluetoothPrinterProfile[]) => {
  let lastError: unknown = null;
  for (const profile of profiles) {
    try {
      const service = await server.getPrimaryService(profile.serviceUuid);
      const characteristic = await service.getCharacteristic(profile.characteristicUuid);
      return { characteristic, profile };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError instanceof Error ? lastError.message : 'La impresora no expone un servicio compatible.');
};

const connectBluetoothPrinter = async (profileId: string, paperWidth: PrinterPaperWidth): Promise<BluetoothPrinterConfig> => {
  const bluetooth = ensureBluetoothPrinterSupport();
  const optionalServices = Array.from(new Set(BLUETOOTH_PRINTER_PROFILES.map(profile => profile.serviceUuid)));
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices
  });

  if (!device?.gatt) {
    throw new Error('No se pudo abrir la conexion GATT de la impresora.');
  }

  const server = await device.gatt.connect();
  const { profile } = await getPrinterCharacteristic(server, getPrinterProfilesToTry(profileId));
  device.gatt.disconnect?.();

  const config: BluetoothPrinterConfig = {
    deviceId: device.id,
    deviceName: device.name || 'Impresora Bluetooth',
    profileId: profile.id,
    serviceUuid: profile.serviceUuid,
    characteristicUuid: profile.characteristicUuid,
    paperWidth,
    connectedAt: new Date().toISOString()
  };
  saveBluetoothPrinterConfig(config);
  return config;
};

const sanitizeReceiptText = (value: unknown) => {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();
};

const centerReceiptLine = (text: string, width: number) => {
  const clean = sanitizeReceiptText(text).slice(0, width);
  const padding = Math.max(0, Math.floor((width - clean.length) / 2));
  return `${' '.repeat(padding)}${clean}`;
};

const receiptPairLine = (left: string, right: string, width: number) => {
  const cleanLeft = sanitizeReceiptText(left);
  const cleanRight = sanitizeReceiptText(right);
  const space = Math.max(1, width - cleanLeft.length - cleanRight.length);
  return `${cleanLeft.slice(0, Math.max(1, width - cleanRight.length - 1))}${' '.repeat(space)}${cleanRight}`;
};

const ESC_POS_BOLD_ON = '\x1bE\x01';
const ESC_POS_BOLD_OFF = '\x1bE\x00';
const ESC_POS_ALIGN_LEFT = '\x1ba\x00';
const ESC_POS_ALIGN_CENTER = '\x1ba\x01';
const ESC_POS_LINE_SPACING_DEFAULT = '\x1b2';
const ESC_POS_LINE_SPACING_BETS = '\x1b3\x2a';

const boldReceiptText = (text: string) => `${ESC_POS_BOLD_ON}${text}${ESC_POS_BOLD_OFF}`;

const buildEscPosQrBytes = (value: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(sanitizeReceiptText(value));
  const storeLen = data.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;
  const commands = [
    new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    new Uint8Array([0x1b, 0x61, 0x01]),
    new Uint8Array([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
    new Uint8Array([0x1b, 0x61, 0x00])
  ];
  const totalLength = commands.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  commands.forEach(chunk => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
};

const buildEscPosBytes = (text: string, qrValue?: string) => {
  const encoder = new TextEncoder();
  const normalizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7E\n]/g, '')
    .trim();
  const content = encoder.encode(normalizedText.replace(/\n/g, '\r\n'));
  const init = new Uint8Array([0x1b, 0x40, 0x1b, 0x74, 0x00]);
  const qr = qrValue ? buildEscPosQrBytes(qrValue) : new Uint8Array();
  const feedAndCut = new Uint8Array([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
  const output = new Uint8Array(init.length + content.length + qr.length + feedAndCut.length);
  output.set(init, 0);
  output.set(content, init.length);
  output.set(qr, init.length + content.length);
  output.set(feedAndCut, init.length + content.length + qr.length);
  return output;
};

const writePrinterBytes = async (characteristic: any, bytes: Uint8Array) => {
  const chunkSize = 20;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.slice(offset, offset + chunkSize);
    if (typeof characteristic.writeValueWithoutResponse === 'function') {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await new Promise(resolve => setTimeout(resolve, 15));
  }
};

const printEscPosText = async (text: string, qrValue?: string) => {
  const config = getSavedBluetoothPrinterConfig();
  if (!config) {
    throw new Error('Configura primero la impresora Bluetooth en Configuracion.');
  }

  if (isNativeAndroid()) {
    if (!config.deviceAddress) {
      throw new Error('Selecciona una impresora vinculada desde Configuracion.');
    }
    await NativeBluetoothPrinter.print({
      address: config.deviceAddress,
      text,
      qr: qrValue
    });
    return;
  }

  const bluetooth = ensureBluetoothPrinterSupport();
  let device: any | undefined;

  if (typeof bluetooth.getDevices === 'function') {
    const devices = await bluetooth.getDevices();
    device = devices.find((item: any) => item.id === config.deviceId);
  }

  if (!device) {
    device = await bluetooth.requestDevice({
      filters: [{ name: config.deviceName }],
      optionalServices: Array.from(new Set(BLUETOOTH_PRINTER_PROFILES.map(profile => profile.serviceUuid)))
    });
  }

  if (!device?.gatt) {
    throw new Error('No se pudo abrir la conexion Bluetooth de la impresora.');
  }

  const server = await device.gatt.connect();
  try {
    const { characteristic, profile } = await getPrinterCharacteristic(server, getPrinterProfilesToTry(config.profileId));
    await writePrinterBytes(characteristic, buildEscPosBytes(text, qrValue));
    if (profile.id !== config.profileId) {
      saveBluetoothPrinterConfig({
        ...config,
        profileId: profile.id,
        serviceUuid: profile.serviceUuid,
        characteristicUuid: profile.characteristicUuid
      });
    }
  } finally {
    device.gatt.disconnect?.();
  }
};

// --- Error Boundary ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

const formatTime12h = (time24: string) => {
  if (!time24) return '--:--';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

interface FirestoreErrorInfo {
  error: string;
  code: string;
  cause: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const firebaseCode = (error as { code?: string })?.code || 'unknown';
  const firebaseMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: firebaseMessage,
    code: firebaseCode,
    cause: firebaseMessage,
    authInfo: {
      userId: auth.currentUser?.uid || 'no-uid',
      email: auth.currentUser?.email || 'no-email',
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || false,
      tenantId: auth.currentUser?.tenantId || 'no-tenant',
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName || 'no-display-name',
        email: provider.email || 'no-email',
        photoUrl: provider.photoURL || 'no-photo'
      })) || []
    },
    operationType,
    path
  }

  const operationLabel = ({
    [OperationType.CREATE]: 'crear',
    [OperationType.UPDATE]: 'actualizar',
    [OperationType.DELETE]: 'eliminar',
    [OperationType.LIST]: 'listar',
    [OperationType.GET]: 'leer',
    [OperationType.WRITE]: 'guardar'
  } as Record<OperationType, string>)[operationType];

  const target = path || 'documento';
  toast.error(
    `Error al ${operationLabel} (${target})`,
    {
      description: `Código: ${firebaseCode} | Causa: ${firebaseMessage}`
    }
  );

  console.error('Firestore Error Details:', JSON.stringify(errInfo, null, 2));
  return errInfo;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string;
  componentStack: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: '', componentStack: '' };
  }

  static getDerivedStateFromError(error: any) {
    return {
      hasError: true,
      errorInfo: error?.stack || error?.message || 'Unknown error',
    };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({
      errorInfo: error?.stack || error?.message || 'Unknown error',
      componentStack: errorInfo?.componentStack || '',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8">
          <div className="bg-white border border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full">
            <h1 className="text-2xl font-bold uppercase italic font-serif mb-4 text-red-600">Error de Sistema</h1>
            <p className="font-mono text-sm mb-6 bg-gray-100 p-4 border border-gray-200 overflow-auto max-h-40">
              {this.state.errorInfo}
            </p>
            {this.state.componentStack && (
              <pre className="font-mono text-xs mb-6 bg-gray-100 p-4 border border-gray-200 overflow-auto max-h-48 whitespace-pre-wrap">
                {this.state.componentStack}
              </pre>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-[#141414] text-white py-3 font-bold uppercase tracking-widest"
            >
              Reiniciar Aplicación
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Components ---

const TicketModal = ({ ticket, results, lotteries, globalSettings, users, canViewPaleSimulation = false, paleSimulationSettings, onClose, selectedLotteryName }: { ticket: LotteryTicket, results: LotteryResult[], lotteries: Lottery[], globalSettings: GlobalSettings, users: UserProfile[], canViewPaleSimulation?: boolean, paleSimulationSettings?: PaleSimulationSettings, onClose: () => void, selectedLotteryName?: string }) => {
  const ticketRef = useRef<HTMLDivElement>(null);
  const [showFullTicket, setShowFullTicket] = useState(!selectedLotteryName);
  const [isPreparingShare, setIsPreparingShare] = useState(false);

  const localTotalAmount = (!showFullTicket && selectedLotteryName)
    ? (ticket.bets || []).filter(b => b.lottery === selectedLotteryName).reduce((sum, b) => sum + (b.amount || 0), 0)
    : ticket.totalAmount;

  const getTicketDate = (t: LotteryTicket) => {
    if (!t.timestamp) return format(new Date(), 'yyyy-MM-dd');
    try {
      if (t.timestamp.toDate) return format(t.timestamp.toDate(), 'yyyy-MM-dd');
      if (t.timestamp instanceof Date) return format(t.timestamp, 'yyyy-MM-dd');
      const d = t.timestamp ? new Date(t.timestamp) : new Date();
      return !isNaN(d.getTime()) ? format(d, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    } catch (e) {
      return format(new Date(), 'yyyy-MM-dd');
    }
  };

  const getTicketPrizesLocal = (ticket: LotteryTicket, results: LotteryResult[]) => {
    let totalPrize = 0;
    const winningBets: { idx: number, prize: number, rank: number, lotteryName: string, winningNumber: string, matchType?: string }[] = [];

    if (ticket.status === 'cancelled') return { totalPrize, winningBets };

    const ticketDate = getTicketDate(ticket);

    (ticket.bets || []).forEach((bet, idx) => {
      if (!showFullTicket && selectedLotteryName && bet.lottery !== selectedLotteryName) return;

      const result = results.find(r => cleanText(r.lotteryName) === cleanText(bet.lottery) && r.date === ticketDate);
      if (!result) return;

      evaluateBetPrizes(bet, result, globalSettings).forEach(hit => {
        totalPrize += hit.prize;
        winningBets.push({ idx, lotteryName: bet.lottery, ...hit });
      });
    });

    return { totalPrize, winningBets };
  };

  const { totalPrize, winningBets } = getTicketPrizesLocal(ticket, results);
  const shareLotteryLabel = selectedLotteryName
    ? cleanText(selectedLotteryName)
    : Array.from(new Set((ticket.bets || []).map(b => cleanText(b.lottery)).filter(Boolean))).join(', ') || 'sorteos varios';
  const sharedLotteryCount = new Set((ticket.bets || [])
    .filter(b => showFullTicket || !selectedLotteryName || normalizePlainText(b?.lottery || '') === normalizePlainText(selectedLotteryName))
    .map(b => normalizePlainText(b?.lottery || ''))
    .filter(Boolean)).size;
  const shareTicketText = sharedLotteryCount > 1
    ? `Ticket: ${ticket.id.slice(0, 8).toUpperCase()}\nTotal: $${localTotalAmount.toFixed(2)}`
    : `Sorteo: ${shareLotteryLabel}\nTotal: $${localTotalAmount.toFixed(2)}`;

  const compartirTicket = async () => {
    const node = ticketRef.current;

    if (!node) {
      console.error('No se encontró el elemento de exportación');
      toast.error('Error al preparar el ticket');
      return;
    }

    try {
      setIsPreparingShare(true);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 200));

      const width = node.scrollWidth;
      const height = node.scrollHeight;

      const dataUrl = await htmlToImage.toPng(node, {
        width,
        height,
        backgroundColor: '#ffffff',
        cacheBust: true,
        pixelRatio: 2,
        filter: element => !(element instanceof HTMLElement && element.dataset.noShare !== undefined),
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          margin: '0',
          left: '0',
          top: '0'
        }
      });

      if (!dataUrl) throw new Error('No se pudo generar la imagen');

      let shared = false;
      if (Capacitor.isNativePlatform()) {
        try {
          const base64Content = dataUrl.split(',')[1];
          const fileName = `ticket-${Date.now()}.png`;
          await Filesystem.writeFile({
            path: fileName,
            data: base64Content,
            directory: Directory.Cache
          });

          const fileUriResult = await Filesystem.getUri({
            directory: Directory.Cache,
            path: fileName
          });
          const fileUri = fileUriResult.uri;

          try {
            await Share.share({
              title: 'Ticket de Juego',
              text: shareTicketText,
              files: [fileUri],
              dialogTitle: 'Compartir Ticket'
            });
            shared = true;
          } catch (textShareErr) {
            if (/cancel/i.test(String((textShareErr as any)?.message || textShareErr))) return;
            await Share.share({
              title: 'Ticket de Juego',
              files: [fileUri],
              dialogTitle: 'Compartir Ticket'
            });
            shared = true;
          }
        } catch (capErr) {
          console.log('Native share failed, trying web fallback', capErr);
        }
      }

      if (!shared) {
        try {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const file = new File([blob], `ticket-${ticket.id.slice(0, 8)}.png`, { type: 'image/png' });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'Ticket de Juego',
              text: shareTicketText,
              files: [file]
            });
            shared = true;
          } else {
            // Do not fallback to text-only share when image files are unsupported.
            // Download the PNG so user can attach it manually and avoid misleading behavior.
            const link = document.createElement('a');
            link.download = `ticket-${ticket.id.slice(0, 8)}.png`;
            link.href = dataUrl;
            link.click();
            toast.info('Tu navegador móvil no permite adjuntar imagen al compartir. Se descargó el ticket para enviarlo manualmente.');
            shared = true;
          }
        } catch (webErr) {
          if (webErr instanceof Error && (webErr.name === 'AbortError' || webErr.message === 'Share canceled')) {
            return; // User canceled
          }
          throw webErr;
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.message === 'Share canceled' || err.name === 'AbortError')) {
        return;
      }
      console.error('Error detallado al compartir:', err);
      toast.error(`Error al compartir: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPreparingShare(false);
    }
  };

  const shareThermalImage = async () => {
    try {
      const dateLabel = ticket.timestamp?.toDate
        ? format(ticket.timestamp.toDate(), 'd/MM/yyyy HH:mm:ss')
        : format(new Date(), 'd/MM/yyyy HH:mm:ss');
      const txCode = ticket.id.slice(0, 8).toUpperCase();
      const lotteryMap = new Map<string, string>();
      (ticket.bets || []).forEach(bet => {
        const rawLottery = (bet?.lottery || '').trim();
        const lotteryKey = normalizePlainText(rawLottery);
        if (lotteryKey && !lotteryMap.has(lotteryKey)) lotteryMap.set(lotteryKey, rawLottery);
      });
      const sections = Array.from(lotteryMap.entries())
        .filter(([lotteryKey]) => showFullTicket || !selectedLotteryName || lotteryKey === normalizePlainText(selectedLotteryName))
        .map(([lotteryKey, lotName]) => {
          const betsForLot = (ticket.bets || []).filter(b => normalizePlainText(b?.lottery || '') === lotteryKey);
          const items = unifyBets(betsForLot.map(b => ({ ...b, lottery: lotName }))).map(bet => {
            const qty = Number(bet.quantity) || 1;
            if (bet.type === 'PL') {
              const num = bet.number?.length === 4 ? `${bet.number.slice(0, 2)}-${bet.number.slice(2, 4)}` : (bet.number || '??');
              return { prefix: 'PL ', number: num, suffix: qty > 1 ? ` x${qty}` : '' };
            }
            if (bet.type === 'BL') return { prefix: 'BL ', number: String(bet.number), suffix: qty > 1 ? ` x${qty}` : '' };
            return { prefix: `${qty}x`, number: String(bet.number), suffix: '' };
          });
          return { title: cleanText(lotName), items };
        });
      const dataUrl = await renderShareReceiptPng({
        qrValue: `ticket:${ticket.id}:${getTicketDate(ticket)}`,
        headerLines: [
          'CHANCE PRO - COMPROBANTE',
          dateLabel,
          `CLIENTE: ${(ticket.customerName || 'Cliente General').toUpperCase()}`,
          `VENDEDOR: ${ticket.sellerCode || '---'}`,
          `TX: ${txCode}`
        ],
        sections,
        txCode,
        prizeTotal: totalPrize,
        total: localTotalAmount
      });
      const result = await shareImageFile(dataUrl, `ticket-${ticket.id.slice(0, 8)}.png`,       'Ticket de Juego', shareTicketText); {
        toast.info('Se descargó la imagen del ticket para compartirla manualmente');
      }
    } catch (err) {
      console.error(err);
      toast.error('No se pudo compartir el ticket');
    }
  };

  const printTicket = () => {
    if (!ticket) return;
    const doc = new jsPDF({
      unit: 'mm',
      format: [80, 180]
    });

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('CHANCE PRO', 40, 15, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text('COMPROBANTE DE VENTA', 40, 20, { align: 'center' });
    doc.setTextColor(0, 0, 0);

    // Metadata
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 180, 180);
    doc.text('FECHA:', 12, 30);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text(ticket.timestamp?.toDate ? format(ticket.timestamp.toDate(), 'dd/MM/yyyy hh:mm a') : format(new Date(), 'dd/MM/yyyy hh:mm a'), 28, 30);
    
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 180, 180);
    doc.text('VENDEDOR:', 12, 35);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text(`${ticket.sellerCode || '---'}`, 28, 35);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 180, 180);
    doc.text('CLIENTE:', 12, 40);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text(ticket.customerName || 'Cliente General', 28, 40);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 180, 180);
    doc.text('SEQ:', 52, 40);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.text(ticket.sequenceNumber || '---', 62, 40);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 180, 180);
    doc.text('TICKET ID:', 12, 45);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text(ticket.id.slice(0, 20), 28, 45);
    
    doc.setDrawColor(245, 245, 245);
    doc.line(12, 50, 68, 50);

    let y = 58;

    // Results in PDF if exist
    const ticketDate = getTicketDate(ticket);
    const relevantResults = results.filter(r => 
      r.date === ticketDate && 
      (ticket.bets || []).some(b => b?.lottery === r.lotteryName) &&
      (showFullTicket || !selectedLotteryName || r.lotteryName === selectedLotteryName)
    );

    if (relevantResults.length > 0) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(150, 150, 150);
      doc.text('RESULTADOS DEL SORTEO', 40, y, { align: 'center' });
      y += 5;
      
      relevantResults.forEach(res => {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text(cleanText(res.lotteryName).toUpperCase(), 12, y);
        y += 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`1ro: ${res.firstPrize}  2do: ${res.secondPrize}  3ro: ${res.thirdPrize}`, 14, y);
        y += 6;
      });
      y += 2;
      doc.line(12, y, 68, y);
      y += 8;
    }

    // Table Header
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 180, 180);
    doc.text('DESCRIPCION', 12, y);
    doc.text('CANT', 48, y, { align: 'center' });
    doc.text('TOTAL', 68, y, { align: 'right' });
    y += 3;
    doc.setDrawColor(245, 245, 245);
    doc.line(12, y, 68, y);
    y += 8;

    // Bets grouped by lottery
    Array.from(new Set((ticket.bets || []).map(b => cleanText(b?.lottery))))
      .filter(lotName => showFullTicket || !selectedLotteryName || lotName === cleanText(selectedLotteryName))
      .forEach(lotName => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text(cleanText(lotName).toUpperCase(), 12, y);
      y += 5;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const betsForLot = (ticket.bets || []).filter(b => b?.lottery === lotName);
      betsForLot.forEach((bet, bIdx) => {
        // Find original index in ticket.bets
        const originalIdx = (ticket.bets || []).findIndex((tb, i) => tb === bet);
        const betWinnings = winningBets.filter(wb => wb.idx === originalIdx);
        const hasWon = betWinnings.length > 0;
        const betTotalPrize = betWinnings.reduce((sum, wb) => sum + wb.prize, 0);

        if (hasWon) {
          doc.setFillColor(255, 250, 200); // Light yellow
          doc.rect(12, y - 4, 56, 6, 'F');
          doc.setFont('helvetica', 'bold');
        } else {
          doc.setFont('helvetica', 'normal');
        }

        let numStr = bet?.number || '??';
        if (bet?.type === 'PL' && numStr.length === 4) {
          numStr = `${numStr.slice(0, 2)}-${numStr.slice(2, 4)}`;
        }
        const desc = `${numStr} (${bet?.type || '?'})`;
        doc.text(desc, 14, y);
        
        if (hasWon) {
          doc.setFontSize(6);
          const matchTypesStr = betWinnings.map(wb => `${wb.rank}º${wb.matchType ? ' ' + wb.matchType : ''}`).join(', ');
          doc.text(`PREMIA: $${betTotalPrize.toFixed(2)} (${matchTypesStr})`, 14, y + 2.5);
          doc.setFontSize(10);
        }

        doc.setTextColor(150, 150, 150);
        doc.text(bet.quantity.toString(), 48, y, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        doc.text(`$${(bet?.amount || 0).toFixed(2)}`, 68, y, { align: 'right' });
        y += 7;
      });
      y += 3;
    });

    // Footer
    y += 2;
    doc.setDrawColor(245, 245, 245);
    doc.line(12, y, 68, y);
    y += 10;

    if (totalPrize > 0) {
      doc.setFillColor(255, 215, 0); // Gold/Yellow
      doc.rect(12, y - 6, 56, 12, 'F');
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('PREMIO TOTAL:', 14, y + 1);
      doc.text(`USD ${totalPrize.toFixed(2)}`, 66, y + 1, { align: 'right' });
      y += 15;
    }

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('TOTAL A PAGAR:', 12, y);
    doc.text(`USD ${localTotalAmount.toFixed(2)}`, 68, y, { align: 'right' });

    y += 10;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('¡Gracias por su compra!', 40, y, { align: 'center' });
    y += 4;
    doc.text('Verifique su ticket antes de salir.', 40, y, { align: 'center' });

    doc.save(`ticket-${ticket.id.slice(0, 8)}.pdf`);
    toast.success('PDF generado correctamente');
  };

  const buildThermalTicketText = () => {
    const config = getSavedBluetoothPrinterConfig();
    const width = config?.paperWidth === '80' ? 40 : 30;
    const line = '-'.repeat(width);
    const ticketDate = getTicketDate(ticket);
    const dateLabel = ticket.timestamp?.toDate
      ? format(ticket.timestamp.toDate(), 'dd/MM/yyyy hh:mm a')
      : format(new Date(), 'dd/MM/yyyy hh:mm a');
    const lines: string[] = [
      ESC_POS_ALIGN_CENTER,
      boldReceiptText(centerReceiptLine('CHANCE PRO', width)),
      centerReceiptLine('COMPROBANTE DE VENTA', width),
      ESC_POS_ALIGN_LEFT,
      line,
      boldReceiptText(`Fecha: ${dateLabel}`),
      boldReceiptText(`Vendedor: ${ticket.sellerCode || '---'}`),
      boldReceiptText(`Cliente: ${ticket.customerName || 'Cliente General'}`),
      boldReceiptText(`Seq: ${ticket.sequenceNumber || '---'}`),
      `Ticket: ${ticket.id.slice(0, Math.max(8, width - 8))}`,
      line,
      ESC_POS_LINE_SPACING_BETS
    ];

    const lotteryEntries = Array.from(
      (ticket.bets || []).reduce((map, bet) => {
        const rawLottery = (bet?.lottery || '').trim();
        const lotteryKey = normalizePlainText(rawLottery);
        if (!lotteryKey) return map;
        if (!map.has(lotteryKey)) map.set(lotteryKey, rawLottery);
        return map;
      }, new Map<string, string>()).entries()
    ).filter(([lotteryKey]) => showFullTicket || !selectedLotteryName || lotteryKey === normalizePlainText(selectedLotteryName));

    lotteryEntries.forEach(([lotteryKey, lotName]) => {
      const betsForLot = (ticket.bets || []).filter(b => normalizePlainText(b?.lottery || '') === lotteryKey);
      const unifiedBetsForLot = unifyBets(betsForLot.map(b => ({ ...b, lottery: lotName })));
      const result = results.find(r => normalizePlainText(r.lotteryName) === lotteryKey && r.date === ticketDate);

      lines.push(boldReceiptText(cleanText(lotName).toUpperCase()));
      if (result) {
        lines.push(`1:${result.firstPrize} 2:${result.secondPrize} 3:${result.thirdPrize}`);
      }

      let packed = '';
      let packedLen = 0;
      const winnerLines: string[] = [];
      const flushPacked = () => {
        if (packedLen > 0) lines.push(`${' '.repeat(Math.max(0, Math.floor((width - packedLen) / 2)))}${packed}`);
        packed = '';
        packedLen = 0;
      };
      unifiedBetsForLot.forEach((bet) => {
        const originalMatches = (ticket.bets || [])
          .map((original, originalIdx) => ({ original, originalIdx }))
          .filter(({ original }) =>
            normalizePlainText(original?.lottery || '') === lotteryKey &&
            original.number === bet.number &&
            original.type === bet.type
          );
        const betWinnings = winningBets.filter(wb => originalMatches.some(match => match.originalIdx === wb.idx));
        const betTotalPrize = betWinnings.reduce((sum, wb) => sum + wb.prize, 0);
        const numStr = bet?.type === 'PL' && bet?.number?.length === 4
          ? `${bet.number.slice(0, 2)}-${bet.number.slice(2, 4)}`
          : (bet?.number || '??');
        const qty = Number(bet.quantity) || 1;
        const label = getBetTypeLabel(bet?.type);
        const prefix = label === 'CH' ? `${qty}x` : label;
        const suffix = label !== 'CH' && qty > 1 ? ` x${qty}` : '';
        const itemLen = prefix.length + numStr.length + suffix.length;
        const separatorLen = packedLen > 0 ? 3 : 0;
        if (packedLen > 0 && packedLen + separatorLen + itemLen > width) flushPacked();
        packed += `${packedLen > 0 ? ' | ' : ''}${prefix}${boldReceiptText(numStr)}${suffix}`;
        packedLen += (packedLen > 0 ? 3 : 0) + itemLen;
        if (betTotalPrize > 0) winnerLines.push(boldReceiptText(`  PREMIA ${numStr}: $${betTotalPrize.toFixed(2)}`));
      });
      flushPacked();
      winnerLines.forEach(winnerLine => lines.push(winnerLine));
      lines.push(line);
    });

    lines.push(ESC_POS_LINE_SPACING_DEFAULT);
    if (totalPrize > 0) {
      lines.push(boldReceiptText(receiptPairLine('PREMIO TOTAL', `USD ${totalPrize.toFixed(2)}`, width)));
    }
    lines.push(boldReceiptText(receiptPairLine('TOTAL A PAGAR', `USD ${localTotalAmount.toFixed(2)}`, width)));
    lines.push(line);
    lines.push(ESC_POS_ALIGN_CENTER);
    lines.push(centerReceiptLine('Gracias por su compra', width));
    lines.push(centerReceiptLine('Verifique su ticket', width));
    lines.push(centerReceiptLine('antes de salir', width));
    lines.push(centerReceiptLine('Presente este ticket', width));
    lines.push(centerReceiptLine('para reclamar su premio', width));
    lines.push(ESC_POS_ALIGN_LEFT);
    lines.push('');

    return lines.join('\n');
  };

  const printBluetoothTicket = async () => {
    if (!ticket) return;
    const toastId = toast.loading('Enviando ticket a impresora...');
    try {
      await printEscPosText(buildThermalTicketText(), `ticket:${ticket.id}:${getTicketDate(ticket)}`);
      toast.success('Ticket enviado a la impresora', { id: toastId });
    } catch (error: any) {
      console.error('Error printing ticket:', error);
      toast.error(error?.message || 'No se pudo imprimir el ticket', { id: toastId });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[#0f172a] text-white p-2 rounded-xl shadow-2xl w-full max-w-md relative max-h-[90vh] overflow-y-auto custom-scrollbar"
      >
        {selectedLotteryName && new Set(ticket.bets.map(b => b.lottery)).size > 1 && (
          <div className="p-4 bg-[#1e293b] border-b border-white/10 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-gray-400">Vista de Ticket</span>
            <div className="flex bg-[#0f172a] p-1 rounded-lg">
              <button 
                onClick={() => setShowFullTicket(false)}
                className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${!showFullTicket ? 'bg-[#1e293b] text-white shadow-sm' : 'text-gray-500'}`}
              >
                Solo {selectedLotteryName}
              </button>
              <button 
                onClick={() => setShowFullTicket(true)}
                className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${showFullTicket ? 'bg-[#1e293b] text-white shadow-sm' : 'text-gray-500'}`}
              >
                Ticket Completo
              </button>
            </div>
          </div>
        )}
        <div id="ticket" ref={ticketRef} className="bg-white p-4 rounded-lg shadow-sm w-full text-black">
          {/* Header */}
          <div className="text-center mb-4 pb-3 border-b border-gray-100">
            <h2 className="text-xl font-bold italic tracking-tighter leading-none mb-1.5">CHANCE PRO</h2>
            <div className="flex items-center justify-center gap-3">
              <span className="h-[1px] w-8 bg-gray-100"></span>
              <p className="text-[10px] font-mono uppercase font-bold tracking-[0.2em] text-gray-400">Comprobante de Venta</p>
              <span className="h-[1px] w-8 bg-gray-100"></span>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-4 text-xs font-mono text-black border-b border-gray-100 pb-4">
            <div className="col-span-2 flex justify-between items-center bg-gray-50/50 p-2 rounded-lg border border-gray-100">
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase text-gray-400 mb-0.5">Cliente</span>
                <span className="font-bold text-xs truncate max-w-[150px]">{ticket.customerName || 'Cliente General'}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold uppercase text-gray-400 mb-0.5">Secuencia</span>
                <span className="font-bold text-xs text-primary">#{ticket.sequenceNumber || '---'}</span>
              </div>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[9px] font-bold uppercase text-gray-400 mb-0.5">Fecha y Hora</span>
              <span className="font-bold text-xs">{ticket.timestamp?.toDate ? format(ticket.timestamp.toDate(), 'dd/MM/yyyy hh:mm a') : 'Procesando...'}</span>
            </div>
            
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold uppercase text-gray-400 mb-0.5">Vendedor</span>
              <span className="font-bold text-xs">{ticket.sellerCode}</span>
            </div>

            <div className="col-span-2 pt-2 border-t border-gray-50">
              <span className="text-[9px] font-bold uppercase block text-gray-400 mb-0.5">Ticket ID</span>
              <span className="font-mono text-[9px] break-all text-gray-500 leading-tight">{ticket.id}</span>
            </div>
          </div>
          
          {/* Bets Table */}
          <div className="mb-4">
            <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1 px-1 border-b border-gray-100 pb-1">
              <span>Descripción</span>
              <div className="flex gap-4">
                <span>Cant</span>
                <span>Subtotal</span>
              </div>
            </div>
            
            <div className="space-y-2">
              {Array.from(
                (ticket.bets || []).reduce((map, bet) => {
                  const rawLottery = (bet?.lottery || '').trim();
                  const lotteryKey = normalizePlainText(rawLottery);
                  if (!lotteryKey) return map;
                  if (!map.has(lotteryKey)) map.set(lotteryKey, rawLottery);
                  return map;
                }, new Map<string, string>()).entries()
              )
                .filter(([lotteryKey]) => showFullTicket || !selectedLotteryName || lotteryKey === normalizePlainText(selectedLotteryName))
                .map(([lotteryKey, lotName]) => {
                const betsForLot = (ticket.bets || []).filter(b => normalizePlainText(b?.lottery || '') === lotteryKey);
                const unifiedBetsForLot = unifyBets(betsForLot.map(b => ({ ...b, lottery: lotName })));
                const ticketDate = getTicketDate(ticket);
                const result = results.find(r => normalizePlainText(r.lotteryName) === lotteryKey && r.date === ticketDate);

                return (
                  <div key={lotName} className="pt-1">
                    <div className="flex justify-between items-center mb-1">
                      <h4 className="text-[10px] font-bold uppercase tracking-tight text-primary flex items-center gap-1">
                        <span className="w-1 h-2 bg-primary rounded-full"></span>
                        {cleanText(lotName)}
                      </h4>
                      {result && (
                        <div className="flex gap-1">
                          <div className="flex items-center gap-1 bg-gray-50 px-1 py-0.5 rounded border border-gray-100">
                            <span className="text-[6px] uppercase font-bold text-gray-400">1ro</span>
                            <span className="text-[8px] font-black">{result.firstPrize}</span>
                          </div>
                          <div className="flex items-center gap-1 bg-gray-50 px-1 py-0.5 rounded border border-gray-100">
                            <span className="text-[6px] uppercase font-bold text-gray-400">2do</span>
                            <span className="text-[8px] font-black">{result.secondPrize}</span>
                          </div>
                          <div className="flex items-center gap-1 bg-gray-50 px-1 py-0.5 rounded border border-gray-100">
                            <span className="text-[6px] uppercase font-bold text-gray-400">3ro</span>
                            <span className="text-[8px] font-black">{result.thirdPrize}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {unifiedBetsForLot.map((bet, idx) => {
                          const betWinnings = winningBets.filter(wb => {
                            const original = (ticket.bets || [])[wb.idx];
                            return Boolean(
                              original &&
                              original.number === bet.number &&
                              original.type === bet.type &&
                              normalizePlainText(original.lottery || '') === lotteryKey &&
                              (bet.type !== 'CH' || Math.abs(getBetUnitPrice(original) - getBetUnitPrice(bet)) < 0.001)
                            );
                          });
                          const hasWon = betWinnings.length > 0;
                          const betTotalPrize = betWinnings.reduce((sum, wb) => sum + wb.prize, 0);
                          const pale13Simulation = canViewPaleSimulation && ticket.status !== 'cancelled'
                            ? getPale13Simulation(bet, result, globalSettings, paleSimulationSettings)
                            : null;
                          const showPale13Simulation = pale13Simulation !== null && !isPreparingShare;
                          const displayAsWinner = hasWon || showPale13Simulation;
                          
                          return (
                            <div key={`${lotName}-${bet.type}-${bet.number}-${idx}`} className={`flex justify-between items-center px-1 py-0.5 rounded transition-colors ${displayAsWinner ? 'bg-yellow-50 border border-yellow-200' : 'hover:bg-gray-50'}`}>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-bold tracking-tight ${displayAsWinner ? 'text-yellow-700' : ''}`}>
                                  {bet?.type === 'PL' && bet?.number?.length === 4 
                                    ? `${bet.number.slice(0, 2)}-${bet.number.slice(2, 4)}`
                                    : (bet?.number || '??')}
                                </span>
                                <span className="text-[9px] font-mono font-bold text-gray-400 uppercase">
                                  {getBetTypeLabel(bet?.type)}
                                </span>
                                {showPale13Simulation && (
                                  <span data-no-share className="ml-1 text-[8px] font-mono bg-violet-600 text-white px-1 rounded font-bold uppercase leading-tight">
                                    1º Palé · {pale13Simulation.prize !== null ? `$${pale13Simulation.prize.toFixed(2)}` : '—'}
                                  </span>
                                )}
                                {hasWon && (
                                  <div className="flex flex-wrap gap-0.5 ml-1">
                                    {betWinnings.map((wb, wIdx) => (
                                      <span key={wIdx} className="text-[8px] font-mono bg-violet-600 text-white px-1 rounded font-bold uppercase leading-tight">
                                        {wb.rank}º{wb.matchType ? ` ${wb.matchType}` : ''} · ${wb.prize.toFixed(2)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-4 items-center">
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] font-mono font-medium text-gray-500">{bet.quantity}</span>
                                  {hasWon && (
                                    <span className="text-[10px] font-black text-violet-700">Premia ${betTotalPrize.toFixed(2)}</span>
                                  )}
                                  {showPale13Simulation && (
                                    <span data-no-share className="text-[10px] font-black text-violet-700">
                                      Premia {pale13Simulation.prize !== null ? `$${pale13Simulation.prize.toFixed(2)}` : '—'}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs font-bold font-mono w-12 text-right">
                                  ${(bet?.amount || 0).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}

              {!showFullTicket && selectedLotteryName && Array.from(new Set((ticket.bets || []).map(b => b?.lottery))).length > 1 && (
                <button 
                  onClick={() => setShowFullTicket(true)}
                  className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold uppercase text-gray-400 hover:border-primary hover:text-primary transition-all"
                >
                  Este ticket contiene otros sorteos. Ver Ticket Completo
                </button>
              )}
            </div>

            {totalPrize > 0 && (
              <div className="mt-4 p-4 bg-gradient-to-br from-violet-600 to-purple-800 rounded-xl flex justify-between items-center shadow-lg shadow-violet-700/30 border-2 border-violet-400">
                <div className="flex items-center gap-2">
                  <div className="bg-white text-violet-700 p-1 rounded-full">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-tighter text-white">PREMIO TOTAL</span>
                </div>
                <span className="text-2xl font-black text-white tracking-tighter">
                  USD {totalPrize.toFixed(2)}
                </span>
              </div>
            )}

            {/* Total Footer */}
            <div className="mt-6 p-4 rounded-xl bg-gradient-to-br from-violet-600 to-purple-800 border-2 border-violet-400 shadow-lg shadow-violet-700/30 text-white">
              <div className="flex justify-between items-end">
                <div className="flex flex-col">
                  <span className="text-xs font-bold uppercase tracking-widest text-violet-200 mb-1">Total a Pagar</span>
                  <span className="text-[10px] font-mono text-violet-200">Moneda: USD</span>
                </div>
                <span className="text-4xl font-bold tracking-tighter leading-none text-white">
                  ${localTotalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* QR and Verification */}
          <div className="flex flex-col items-center gap-4 bg-gray-50/50 p-4 rounded-xl border border-gray-100">
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <QRCode value={`ticket:${ticket.id}:${getTicketDate(ticket)}`} size={80} />
            </div>
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-800">¡Buena Suerte!</p>
              <p className="text-[10px] font-mono uppercase text-gray-400 max-w-[200px] leading-relaxed">Este comprobante es indispensable para reclamar su premio.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 p-4 border-t border-gray-100">
          <button 
            onClick={() => printBluetoothTicket()}
            className="flex items-center justify-center gap-2 bg-black text-white py-3 rounded-lg font-bold text-xs uppercase hover:bg-gray-800 transition-colors"
          >
            <Printer className="w-4 h-4" /> Imprimir
          </button>
          <button 
            onClick={() => shareThermalImage()}
            className="flex items-center justify-center gap-2 bg-violet-600 text-white py-3 rounded-lg font-bold text-xs uppercase hover:bg-violet-700 transition-colors"
          >
            <Share2 className="w-4 h-4" /> Share
          </button>
          <button 
            onClick={() => compartirTicket()}
            className="col-span-2 flex items-center justify-center gap-2 bg-violet-600 text-white py-3 rounded-lg font-bold text-xs uppercase hover:bg-violet-700 transition-colors"
          >
            <Share2 className="w-4 h-4" /> Compartir
          </button>
          <button 
            onClick={onClose}
            className="col-span-2 mt-2 flex items-center justify-center gap-2 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold text-xs uppercase hover:bg-gray-200 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const TicketQrScannerModal = ({ show, onClose, onScan }: { show: boolean; onClose: () => void; onScan: (value: string) => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [scannerError, setScannerError] = useState('');

  useEffect(() => {
    if (!show) return;

    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopCamera = () => {
      if (intervalId) clearInterval(intervalId);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };

    const startScanner = async () => {
      setScannerError('');
      try {
        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          setScannerError('Este dispositivo no permite lectura QR automática. Ingresa el código manualmente.');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        if (stopped) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
        intervalId = setInterval(async () => {
          if (!videoRef.current || stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const rawValue = codes?.[0]?.rawValue;
            if (rawValue) {
              stopped = true;
              stopCamera();
              onScan(rawValue);
            }
          } catch {
            // Keep scanning; some frames fail while the camera adjusts focus.
          }
        }, 700);
      } catch (error: any) {
        setScannerError(error?.message || 'No se pudo abrir la cámara.');
      }
    };

    startScanner();

    return () => {
      stopped = true;
      stopCamera();
    };
  }, [onScan, show]);

  if (!show) return null;

  const submitManualCode = () => {
    const value = manualCode.trim();
    if (!value) return;
    onScan(value);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card w-full max-w-md p-4 sm:p-6 space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20 text-primary">
              <ScanQrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black uppercase tracking-widest text-sm">Verificar Ticket</h3>
              <p className="text-xs font-mono font-bold text-muted-foreground uppercase">Escanea el QR impreso</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-8 border-2 border-primary/70 rounded-xl pointer-events-none" />
          <div className="absolute left-8 right-8 top-1/2 h-0.5 bg-primary/80 shadow-[0_0_18px_rgba(34,211,238,0.8)] pointer-events-none" />
        </div>

        {scannerError && (
          <p className="text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 leading-relaxed">
            {scannerError}
          </p>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Primeros 6 del ticket"
            className="min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-xs focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={submitManualCode}
            className="px-4 py-3 bg-primary text-primary-foreground rounded-xl font-black uppercase text-xs tracking-widest"
          >
            Buscar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [inactiveUserMessage, setInactiveUserMessage] = useState('');

  const handleResetPassword = async () => {
    if (!username) {
      toast.error('Ingrese su correo para restablecer la contraseña');
      return;
    }
    const cleanUsername = username.trim().toLowerCase().replace(/\s/g, '');
    const email = username.includes('@') ? username.trim() : `${cleanUsername}@chancepro.local`;
    
    const toastId = toast.loading('Enviando correo de restablecimiento...');
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success('Correo de restablecimiento enviado. Revise su bandeja de entrada.', { id: toastId });
    } catch (error: any) {
      console.error("Reset password failed", error);
      toast.error(`Error: ${error.message}`, { id: toastId });
    }
  };

  useEffect(() => {
    console.log("Login component mounted. Auth state:", auth.currentUser ? "Logged in" : "Logged out");
  }, []);

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("handleCredentialsLogin triggered", { username });
    
    if (!username || !password) {
      toast.error('Ingrese usuario y contraseña');
      return;
    }
    
    setLoading(true);
    const toastId = toast.loading('Iniciando sesión...');
    
    try {
      if (!auth) {
        throw new Error("Firebase Auth no está inicializado");
      }

      const cleanUsername = username.trim().toLowerCase().replace(/\s/g, '');
      let email = username.includes('@') ? username.trim() : `${cleanUsername}@chancepro.local`;
      
      const ceoEmail = import.meta.env.VITE_CEO_EMAIL || 'zsayeth09@gmail.com';
      const ceoUsername = ceoEmail.split('@')[0];

      // Prevent CEO from accidentally using local domain
      if (cleanUsername === ceoUsername && !username.includes('@')) {
        email = ceoEmail;
      }
      
      console.log("Attempting auth with email:", email);
      
      console.log("Calling signInWithEmailAndPassword...");
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const signedInEmail = (userCredential.user.email || email).toLowerCase();

      const userDoc = await getDoc(doc(db, 'users', signedInEmail));
      if (!userDoc.exists() && signedInEmail !== ceoEmail.toLowerCase()) {
        await signOut(auth);
        localStorage.removeItem('sessionBusinessDay');
        toast.error('Tu usuario no existe en la base de datos.');
        return;
      }

      if (userDoc.exists()) {
        const profile = userDoc.data() as UserProfile;
        if ((profile.status || 'active') !== 'active') {
          await signOut(auth);
          localStorage.removeItem('sessionBusinessDay');
          toast.dismiss(toastId);
          setInactiveUserMessage('Usuario inactivo. Contactar al administrador.');
          return;
        }
      }
      console.log("User signed in successfully:", userCredential.user.uid);
      localStorage.setItem('sessionBusinessDay', format(getBusinessDate(), 'yyyy-MM-dd'));
      
      toast.success('Sesión iniciada', { id: toastId });
    } catch (error: any) {
      console.error("Auth failed error details:", error);
      let errorMessage = "Credenciales incorrectas";
      
      if (error.code === 'auth/invalid-credential') {
        errorMessage = "Credenciales incorrectas (usuario o contraseña no coinciden). Si olvidó su clave, use el botón de recuperar.";
        if (!username.includes('@')) {
          errorMessage += ". Verifique si debe usar su correo completo (ej: @gmail.com)";
        }
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "El formato del correo no es válido";
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = "Error de red. Verifique su conexión a internet.";
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = "El inicio de sesión con correo/contraseña no está habilitado en Firebase";
      } else if (error.message) {
        errorMessage = `Error: ${error.message}`;
      }
      
      toast.error(errorMessage, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background Accents */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px]" />

      {inactiveUserMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-sm rounded-2xl border border-red-500/30 bg-[#111827] p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setInactiveUserMessage('')}
              className="absolute right-3 top-3 rounded-lg p-2 text-muted-foreground hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="pr-8 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center border border-red-500/20">
                <UserIcon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black uppercase tracking-widest text-white">Usuario inactivo</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Tu usuario se encuentra desactivado. Contactar al administrador.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <motion.div 
        key="login-form-container"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full glass-card p-8 sm:p-10 relative z-10 neon-border"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-4 border border-primary/30">
            <TicketIcon className="w-8 h-8 text-primary neon-text" />
          </div>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase neon-text">
            <span>Chance Pro</span>
          </h1>
          <p className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-[0.2em] mt-2">
            <span>Sistema de Gestión v1.0.0</span>
          </p>
        </div>
        
        <form onSubmit={handleCredentialsLogin} className="space-y-5">
          <div className="space-y-2">
            <label className="            block text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground ml-1">
              <span>Usuario / Email</span>
            </label>
            <div className="relative">
              <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/5 border border-white/10 p-4 pl-12 rounded-xl font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all placeholder:text-muted-foreground/30"
                placeholder="vendedor01"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="            block text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground ml-1">
              <span>Contraseña</span>
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 p-4 pl-12 rounded-xl font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all placeholder:text-muted-foreground/30"
                placeholder="••••••••"
              />
            </div>
          </div>
          
          <div className="flex justify-end">
            <button 
              type="button"
              onClick={handleResetPassword}
              className="text-xs font-mono font-bold uppercase tracking-widest text-primary hover:underline"
            >
              <span>¿Olvidó su contraseña?</span>
            </button>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-black uppercase tracking-[0.2em] text-xs shadow-lg shadow-primary/20 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <><span>Ingresar al Sistema</span> <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const ConfirmationModal = ({ show, title, message, onConfirm, onClose }: { 
  show: boolean; 
  title: string; 
  message: string; 
  onConfirm: () => void; 
  onClose: () => void; 
}) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-sm w-full p-4 md:p-8 text-center"
      >
        <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <Trash2 className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-black uppercase tracking-tighter mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-8">{message}</p>
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={onClose}
            className="py-3 px-6 rounded-xl border border-border font-bold text-xs uppercase hover:bg-white/5 transition-colors"
          >
            Cancelar
          </button>
          <button 
            onClick={() => { onConfirm(); onClose(); }}
            className="py-3 px-6 rounded-xl bg-red-600 text-white font-bold text-xs uppercase hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
          >
            Confirmar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const LotterySelectorModal = ({ show, lotteries, onSelect, onClose }: {
  show: boolean;
  lotteries: Lottery[];
  onSelect: (lotteryName: string) => void;
  onClose: () => void;
}) => {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-md w-full p-4 md:p-8"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black uppercase tracking-tighter italic">Seleccionar Sorteo</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-6 uppercase font-mono tracking-widest">¿Para qué sorteo desea duplicar esta lista?</p>
        <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
          {lotteries.filter(l => l.active).map(lot => (
            <button
              key={lot.id}
              onClick={() => { onSelect(lot.name); onClose(); }}
              className="w-full p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all text-left group flex justify-between items-center"
            >
              <div className="flex flex-col">
                <span className="font-bold uppercase tracking-widest text-sm">{cleanText(lot.name)}</span>
                {lot.drawTime && <span className="text-xs font-mono font-bold opacity-70">S: {formatTime12h(lot.drawTime)}</span>}
              </div>
              <ChevronRight className="w-4 h-4 transition-opacity" />
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

const ResultModal = ({ show, result, lotteries, onSave, onClose }: {
  show: boolean;
  result: LotteryResult | null;
  lotteries: Lottery[];
  onSave: (data: Partial<LotteryResult>) => void;
  onClose: () => void;
}) => {
  const [lotteryId, setLotteryId] = useState('');
  const [date, setDate] = useState(format(getBusinessDate(), 'yyyy-MM-dd'));
  const [firstPrize, setFirstPrize] = useState('');
  const [secondPrize, setSecondPrize] = useState('');
  const [thirdPrize, setThirdPrize] = useState('');

  useEffect(() => {
    if (result) {
      setLotteryId(result.lotteryId);
      setDate(result.date);
      setFirstPrize(result.firstPrize);
      setSecondPrize(result.secondPrize);
      setThirdPrize(result.thirdPrize);
    } else {
      setLotteryId('');
      setDate(format(getBusinessDate(), 'yyyy-MM-dd'));
      setFirstPrize('');
      setSecondPrize('');
      setThirdPrize('');
    }
  }, [result, show]);

  if (!show) return null;

  const selectedLottery = lotteries.find(l => l.id === lotteryId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-md w-full p-4 md:p-8"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black uppercase tracking-tighter italic">
            {result ? 'Editar Resultado' : 'Nuevo Resultado'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Sorteo</label>
            <select 
              value={lotteryId}
              onChange={(e) => setLotteryId(e.target.value)}
              className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
            >
              <option key="default" value="" className="bg-[#111827]">Seleccionar Sorteo</option>
              {lotteries.map(l => (
                <option key={l.id} value={l.id} className="bg-[#111827]">{cleanText(l.name)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Fecha del Sorteo</label>
            <input 
              type="date" 
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">1er Premio</label>
              <input 
                type="text" 
                maxLength={selectedLottery?.isFourDigits ? 4 : 2}
                value={firstPrize === 'NaN' ? '' : firstPrize}
                onChange={(e) => setFirstPrize(e.target.value.replace(/\D/g, ''))}
                placeholder={selectedLottery?.isFourDigits ? "0000" : "00"}
                className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm font-bold text-center focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">2do Premio</label>
              <input 
                type="text" 
                maxLength={selectedLottery?.isFourDigits ? 4 : 2}
                value={secondPrize === 'NaN' ? '' : secondPrize}
                onChange={(e) => setSecondPrize(e.target.value.replace(/\D/g, ''))}
                placeholder={selectedLottery?.isFourDigits ? "0000" : "00"}
                className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm font-bold text-center focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">3er Premio</label>
              <input 
                type="text" 
                maxLength={selectedLottery?.isFourDigits ? 4 : 2}
                value={thirdPrize === 'NaN' ? '' : thirdPrize}
                onChange={(e) => setThirdPrize(e.target.value.replace(/\D/g, ''))}
                placeholder={selectedLottery?.isFourDigits ? "0000" : "00"}
                className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm font-bold text-center focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          
          <div className="pt-4 grid grid-cols-2 gap-4">
            <button 
              onClick={onClose}
              className="py-3 px-6 rounded-xl border border-border font-bold text-xs uppercase hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={() => {
                const name = selectedLottery?.name || lotteries.find(l => l.id === lotteryId)?.name || 'Sorteo Desconocido';
                onSave({ 
                  lotteryId, 
                  lotteryName: cleanText(name), 
                  date, 
                  firstPrize, 
                  secondPrize, 
                  thirdPrize 
                });
              }}
              disabled={!lotteryId || !date || [firstPrize, secondPrize, thirdPrize].some(v => v.length !== (selectedLottery?.isFourDigits ? 4 : 2))}
              className="py-3 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase hover:brightness-110 transition-all disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const LotteryModal = ({ show, lottery, onSave, onClose, globalSettings }: {
  show: boolean;
  lottery: Lottery | null;
  onSave: (data: Partial<Lottery>) => void;
  onClose: () => void;
  globalSettings: GlobalSettings | null;
}) => {
  const [name, setName] = useState('');
  const [drawTime, setDrawTime] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const [isFourDigits, setIsFourDigits] = useState(false);
  const [allowPale, setAllowPale] = useState(true);
  const [allowBillete, setAllowBillete] = useState(false);
  const [billeteClosingTime, setBilleteClosingTime] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (lottery) {
      setName(cleanText(lottery.name));
      setDrawTime(lottery.drawTime || '');
      setClosingTime(lottery.closingTime || '');
      setIsFourDigits(lottery.isFourDigits || false);
      setAllowPale(lottery.allowPale !== false);
      setAllowBillete(lotteryAllowsBillete(lottery));
      setBilleteClosingTime(lottery.billeteClosingTime || '');
      setIsActive(lottery.active !== false);
    } else {
      setName('');
      setDrawTime('');
      setClosingTime('');
      setIsFourDigits(false);
      setAllowPale(true);
      setAllowBillete(false);
      setBilleteClosingTime('');
      setIsActive(true);
    }
  }, [lottery, show]);

  if (!show) return null;

  const handleSave = () => {
    onSave({
      name,
      drawTime,
      closingTime,
      isFourDigits,
      allowPale,
      allowBillete: isFourDigits ? allowBillete : false,
      billeteClosingTime: isFourDigits && allowBillete ? billeteClosingTime : '',
      active: isActive
    });
  };

  const renderSwitch = (label: string, value: boolean, onToggle: () => void) => (
    <div className="flex items-center justify-between">
      <span className="text-xs font-mono font-bold uppercase text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onToggle}
        className={`w-12 h-6 rounded-full transition-all relative ${value ? 'bg-primary' : 'bg-white/10'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${value ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-md w-full p-4 md:p-8 max-h-[92vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black uppercase tracking-tighter italic">
            {lottery ? 'Editar Sorteo' : 'Nuevo Sorteo'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-xs font-mono font-extrabold uppercase text-primary border-b border-white/10 pb-1">Información Básica</h4>
            <div>
              <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Nombre del Sorteo</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Lotería de Medellín"
                className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Hora del Sorteo (opcional)</label>
                <input 
                  type="time" 
                  value={drawTime}
                  onChange={(e) => setDrawTime(e.target.value)}
                  className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Hora de Cierre (opcional)</label>
                <input 
                  type="time" 
                  value={closingTime}
                  onChange={(e) => setClosingTime(e.target.value)}
                  className="w-full bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <p className="text-[11px] font-semibold text-muted-foreground italic">Sin hora de cierre el sorteo permanece abierto para ventas mientras esté activo.</p>
            <div>
              <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Modalidad de Cifras</label>
              <div className="grid grid-cols-2 gap-2">
                {[2, 4].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setIsFourDigits(mode === 4)}
                    className={`py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${(isFourDigits ? 4 : 2) === mode ? 'bg-primary border-transparent text-primary-foreground shadow-lg' : 'bg-transparent border-white/10 text-slate-300'}`}
                  >
                    {mode} Cifras
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground mt-1 italic">Cada premio del resultado debe tener exactamente esa cantidad de cifras.</p>
            </div>
            {isFourDigits && allowBillete && (
              <div>
                <label className="text-xs font-mono font-bold uppercase text-muted-foreground block mb-1">Cierre de Billete (opcional)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={billeteClosingTime}
                    onChange={(e) => setBilleteClosingTime(e.target.value)}
                    className="flex-1 bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {billeteClosingTime && (
                    <button type="button" onClick={() => setBilleteClosingTime('')} className="px-2 py-1 text-[10px] font-black uppercase text-slate-300 border border-white/10 rounded-lg">Quitar</button>
                  )}
                </div>
                <p className="text-[11px] font-semibold text-muted-foreground mt-1 italic">Vacío = los billetes cierran junto con el sorteo.</p>
              </div>
            )}
            <div className="space-y-3 pt-1">
              {renderSwitch('Permitir Jugada de Palé', allowPale, () => setAllowPale(!allowPale))}
              {isFourDigits && renderSwitch('Permitir Jugada de Billete', allowBillete, () => setAllowBillete(!allowBillete))}
              {renderSwitch('Sorteo Activo', isActive, () => setIsActive(!isActive))}
            </div>
          </div>
          
          <div className="pt-4 grid grid-cols-2 gap-4">
            <button 
              onClick={onClose}
              className="py-3 px-6 rounded-xl border border-border font-bold text-xs uppercase hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleSave}
              disabled={!name}
              className="py-3 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase hover:brightness-110 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const ChancePricesSection = ({ settings, canEdit, onSave }: {
  settings: GlobalSettings;
  canEdit: boolean;
  onSave: (prices: ChancePriceConfig[]) => void;
}) => {
  const prices = [...(settings.chancePrices || [])].sort((a, b) => a.price - b.price);
  const [editing, setEditing] = useState<{ original: ChancePriceConfig | null; form: { price: string; ch1: string; ch2: string; ch3: string } } | null>(null);
  const [error, setError] = useState('');

  const openForm = (original: ChancePriceConfig | null) => {
    setError('');
    setEditing({
      original,
      form: {
        price: original ? String(original.price) : '',
        ch1: original ? String(original.ch1) : '60',
        ch2: original ? String(original.ch2) : '8',
        ch3: original ? String(original.ch3) : '4',
      },
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const next = {
      price: parseFloat(editing.form.price),
      ch1: parseFloat(editing.form.ch1),
      ch2: parseFloat(editing.form.ch2),
      ch3: parseFloat(editing.form.ch3),
    };
    if ([next.price, next.ch1, next.ch2, next.ch3].some(v => Number.isNaN(v) || v < 0) || next.price <= 0) {
      setError('Introduce valores numéricos válidos.');
      return;
    }
    const duplicate = (settings.chancePrices || []).some(p => p.price === next.price && p !== editing.original);
    if (duplicate) {
      setError('Ya existe un precio con ese valor.');
      return;
    }
    const list = settings.chancePrices || [];
    onSave(editing.original ? list.map(p => (p === editing.original ? next : p)) : [...list, next]);
    setEditing(null);
  };

  const removePrice = (target: ChancePriceConfig) => {
    if (window.confirm(`¿Eliminar el precio $${target.price.toFixed(2)}?`)) {
      onSave((settings.chancePrices || []).filter(p => p !== target));
    }
  };

  const fieldClass = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-2">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-widest">Precios de Chances</h2>
          <p className="text-xs text-white/50 font-bold uppercase tracking-wider">Configura los valores y pagos de los chances.</p>
        </div>
        {canEdit && (
          <button onClick={() => openForm(null)} className="bg-primary text-primary-foreground px-4 h-10 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all shrink-0 whitespace-nowrap">
            <Plus className="w-4 h-4" /> Añadir Precio
          </button>
        )}
      </div>

      <div className="space-y-2">
        {prices.length === 0 && (
          <p className="text-center py-12 text-sm font-bold text-white/50">No hay precios de chance. Añade el primero para empezar a vender.</p>
        )}
        {prices.map(p => (
          <div key={p.price} className="bg-white/5 rounded-2xl border border-white/10 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-sm text-white">${p.price.toFixed(2)}</p>
              <div className="flex flex-wrap gap-x-4 mt-1 text-xs text-white/60">
                <span><span className="font-bold text-white/80">1er:</span> x{p.ch1}</span>
                <span><span className="font-bold text-white/80">2do:</span> x{p.ch2}</span>
                <span><span className="font-bold text-white/80">3er:</span> x{p.ch3}</span>
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center shrink-0">
                <button onClick={() => openForm(p)} className="p-2 rounded-lg text-white/50 hover:text-white transition-colors"><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => removePrice(p)} className="p-2 rounded-lg text-white/40 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()} className="glass-card w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-white text-sm uppercase tracking-wider">{editing.original ? 'Editar Precio' : 'Nuevo Precio'}</h3>
              <button type="button" onClick={() => setEditing(null)} className="p-1 text-white/60 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-white/70 uppercase tracking-widest">Valor por Chance ($)</label>
              <input className={fieldClass} type="number" step="0.01" inputMode="decimal" value={editing.form.price} onChange={e => setEditing({ ...editing, form: { ...editing.form, price: e.target.value } })} />
            </div>
            <p className="text-xs font-black text-white/70 uppercase tracking-widest">Pagos por posición (multiplicador)</p>
            <div className="grid grid-cols-3 gap-2">
              {([['ch1', '1ra'], ['ch2', '2da'], ['ch3', '3ra']] as const).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[11px] font-black text-white/60 uppercase">{label}</label>
                  <input className={fieldClass} type="number" inputMode="decimal" value={editing.form[key]} onChange={e => setEditing({ ...editing, form: { ...editing.form, [key]: e.target.value } })} />
                </div>
              ))}
            </div>
            {error && <p className="text-xs font-bold text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditing(null)} className="w-full bg-white/10 text-white/80 h-10 rounded-2xl font-black uppercase text-xs tracking-widest">Cancelar</button>
              <button type="submit" className="w-full bg-primary text-primary-foreground h-10 rounded-2xl font-black uppercase text-xs tracking-widest">Guardar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const ComboLimitFields = ({ limit, setLimit, fixed, setFixed }: {
  limit: string;
  setLimit: (v: string) => void;
  fixed: string;
  setFixed: (v: string) => void;
}) => (
  <div className="grid grid-cols-2 gap-2 pt-1">
    <div className="bg-black/20 px-2 py-1.5 rounded-lg">
      <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground block">Límite por combinación ($)</label>
      <input
        type="number"
        step="0.01"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        className="w-full bg-transparent border-none p-0 text-sm font-bold focus:outline-none focus:ring-0"
      />
    </div>
    <div className="bg-black/20 px-2 py-1.5 rounded-lg">
      <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground block">Costo fijo (opcional)</label>
      <input
        type="text"
        placeholder="Ej: 1"
        value={fixed}
        onChange={(e) => setFixed(e.target.value)}
        className="w-full bg-transparent border-none p-0 text-sm font-bold focus:outline-none focus:ring-0"
      />
    </div>
    <p className="col-span-2 text-[11px] font-semibold text-muted-foreground italic">
      El límite es lo máximo que se vende por combinación entre todos los vendedores. El costo fijo es el monto mínimo y el paso: con $1 solo se factura 1, 2, 3... (no 1.50). Sin costo fijo se permite desde $0.10. Al superar el límite la venta se bloquea.
    </p>
  </div>
);

const GlobalSettingsModal = ({ show, settings, onSave, onClose, section, inline = false }: {
  show: boolean;
  settings: GlobalSettings;
  onSave: (data: GlobalSettings) => void;
  onClose: () => void;
  section?: 'chances' | 'especiales';
  inline?: boolean;
}) => {
  const showChances = !section || section === 'chances';
  const showEspeciales = !section || section === 'especiales';
  const [chancePrices, setChancePrices] = useState<ChancePriceConfig[]>(settings.chancePrices || []);
  const [palesEnabled, setPalesEnabled] = useState(settings.palesEnabled);
  const [billetesEnabled, setBilletesEnabled] = useState(settings.billetesEnabled);
  const [pl12, setPl12] = useState(settings.pl12Multiplier.toString());
  const [pl13, setPl13] = useState(settings.pl13Multiplier.toString());
  const [pl23, setPl23] = useState(settings.pl23Multiplier.toString());
  const [palesLimit, setPalesLimit] = useState(String(settings.palesLimit ?? DEFAULT_COMBO_LIMIT));
  const [billetesLimit, setBilletesLimit] = useState(String(settings.billetesLimit ?? DEFAULT_COMBO_LIMIT));
  const [palesFixed, setPalesFixed] = useState((settings.palesFixedAmounts || []).join(', '));
  const [billetesFixed, setBilletesFixed] = useState((settings.billetesFixedAmounts || []).join(', '));
  const parseFixedAmounts = (raw: string) =>
    Array.from(new Set(raw.split(/[\s,;]+/).map(v => parseFloat(v)).filter(v => !Number.isNaN(v) && v >= 0.10))).sort((a, b) => a - b).slice(0, 1);
  const defaultBilletePrizes = {
    full4: 2000,
    first3: 200,
    last3: 200,
    first2: 20,
    last2: 20
  };
  const [billeteMultipliers, setBilleteMultipliers] = useState(settings.billeteMultipliers || {
    p1: { ...defaultBilletePrizes },
    p2: { ...defaultBilletePrizes },
    p3: { ...defaultBilletePrizes }
  });

  useEffect(() => {
    setChancePrices(settings.chancePrices || []);
    setPalesEnabled(settings.palesEnabled);
    setBilletesEnabled(settings.billetesEnabled);
    setPl12(settings.pl12Multiplier.toString());
    setPl13(settings.pl13Multiplier.toString());
    setPl23(settings.pl23Multiplier.toString());
    setPalesLimit(String(settings.palesLimit ?? DEFAULT_COMBO_LIMIT));
    setBilletesLimit(String(settings.billetesLimit ?? DEFAULT_COMBO_LIMIT));
    setPalesFixed((settings.palesFixedAmounts || []).join(', '));
    setBilletesFixed((settings.billetesFixedAmounts || []).join(', '));
    setBilleteMultipliers(settings.billeteMultipliers || {
      p1: { ...defaultBilletePrizes },
      p2: { ...defaultBilletePrizes },
      p3: { ...defaultBilletePrizes }
    });
  }, [settings, show]);

  if (!show) return null;

  const handleAddPrice = () => {
    setChancePrices([...chancePrices, { price: 0, ch1: 0, ch2: 0, ch3: 0 }]);
  };

  const handleRemovePrice = (index: number) => {
    setChancePrices(chancePrices.filter((_, i) => i !== index));
  };

  const handlePriceChange = (index: number, field: keyof ChancePriceConfig, value: number) => {
    const newPrices = [...chancePrices];
    newPrices[index] = { ...newPrices[index], [field]: value };
    setChancePrices(newPrices);
  };

  const handleSave = () => {
    const pLimit = parseFloat(palesLimit);
    const bLimit = parseFloat(billetesLimit);
    if (showEspeciales && (!(pLimit >= 0.10) || !(bLimit >= 0.10))) {
      toast.error('El límite por combinación debe ser al menos USD 0.10');
      return;
    }
    const pFixed = parseFixedAmounts(palesFixed);
    const bFixed = parseFixedAmounts(billetesFixed);
    if (showEspeciales && (pFixed.some(v => v > pLimit) || bFixed.some(v => v > bLimit))) {
      toast.error('Un costo fijo no puede superar el límite por combinación');
      return;
    }
    onSave({
      ...settings,
      chancePrices,
      palesEnabled,
      billetesEnabled,
      pl12Multiplier: parseFloat(pl12),
      pl13Multiplier: parseFloat(pl13),
      pl23Multiplier: parseFloat(pl23),
      billeteMultipliers,
      palesLimit: showEspeciales ? pLimit : settings.palesLimit,
      billetesLimit: showEspeciales ? bLimit : settings.billetesLimit,
      palesFixedAmounts: showEspeciales ? pFixed : settings.palesFixedAmounts,
      billetesFixedAmounts: showEspeciales ? bFixed : settings.billetesFixedAmounts,
    });
  };

  return (
    <div className={inline ? '' : 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm'}>
      <motion.div 
        initial={inline ? false : { scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={inline ? 'w-full' : 'glass-card max-w-2xl w-full p-4 md:p-8 max-h-[90vh] overflow-y-auto custom-scrollbar'}
      >
        {!inline && (
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black uppercase tracking-tighter italic">
              Configuración Global de Premios
            </h3>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
        )}
        
        <div className="space-y-8">
          {/* Chance Prices Section */}
          {showChances && (
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-white/10 pb-1">
              <h4 className="text-xs font-mono font-extrabold uppercase text-primary">Precios y Premios de Chance (CH)</h4>
              <button 
                onClick={handleAddPrice}
                className="flex items-center gap-1 text-[11px] font-extrabold uppercase bg-primary/20 text-primary px-2 py-1 rounded hover:bg-primary/30 transition-colors"
              >
                <Plus className="w-3 h-3" /> Añadir Precio
              </button>
            </div>
            
            <div className="space-y-4">
              {chancePrices.length === 0 && (
                <p className="text-xs text-muted-foreground italic text-center py-4">No hay precios configurados. Añada uno para vender Chance.</p>
              )}
              {chancePrices.map((config, idx) => (
                <div key={idx} className="bg-white/5 border border-border rounded-xl p-4 relative group">
                  <button 
                    onClick={() => handleRemovePrice(idx)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full transition-opacity shadow-lg"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="text-[11px] font-mono font-bold uppercase text-muted-foreground block mb-1">Precio (USD)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={Number.isNaN(config.price) ? '' : config.price}
                        onChange={(e) => handlePriceChange(idx, 'price', parseFloat(e.target.value))}
                        className="w-full bg-black/20 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono font-bold uppercase text-muted-foreground block mb-1">1er Premio (x)</label>
                      <input 
                        type="number" 
                        value={Number.isNaN(config.ch1) ? '' : config.ch1}
                        onChange={(e) => handlePriceChange(idx, 'ch1', parseFloat(e.target.value))}
                        className="w-full bg-black/20 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono font-bold uppercase text-muted-foreground block mb-1">2do Premio (x)</label>
                      <input 
                        type="number" 
                        value={Number.isNaN(config.ch2) ? '' : config.ch2}
                        onChange={(e) => handlePriceChange(idx, 'ch2', parseFloat(e.target.value))}
                        className="w-full bg-black/20 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-mono font-bold uppercase text-muted-foreground block mb-1">3er Premio (x)</label>
                      <input 
                        type="number" 
                        value={Number.isNaN(config.ch3) ? '' : config.ch3}
                        onChange={(e) => handlePriceChange(idx, 'ch3', parseFloat(e.target.value))}
                        className="w-full bg-black/20 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          )}

          {showEspeciales && (<>
          {/* Palés */}
          <div className="space-y-3">
            <div className="flex justify-between items-center border-b border-white/10 pb-1">
              <h4 className="text-xs font-mono font-extrabold uppercase text-primary">Palés</h4>
              <button 
                onClick={() => setPalesEnabled(!palesEnabled)}
                className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase transition-all border ${
                  palesEnabled ? 'bg-green-500/20 border-green-500 text-green-500' : 'bg-red-500/20 border-red-500 text-red-500'
                }`}
              >
                {palesEnabled ? 'Activado' : 'Desactivado'}
              </button>
            </div>
            
            {palesEnabled && (
              <div className="bg-white/5 border border-white/10 p-3 rounded-xl space-y-2">
                <h5 className="text-[11px] font-mono font-extrabold uppercase text-muted-foreground">Multiplicador de apuesta</h5>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['1ro con 2do', pl12, setPl12],
                    ['1ro con 3ro', pl13, setPl13],
                    ['2do con 3ro', pl23, setPl23],
                  ] as const).map(([label, value, setValue]) => (
                    <div key={label} className="bg-black/20 px-2 py-1.5 rounded-lg">
                      <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground block">{label}</label>
                      <input 
                        type="number" 
                        value={value === 'NaN' ? '' : value}
                        onChange={(e) => setValue(e.target.value)}
                        className="w-full bg-transparent border-none p-0 text-sm font-bold focus:outline-none focus:ring-0"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] font-semibold text-muted-foreground italic">El premio es lo apostado por el multiplicador.</p>
                <ComboLimitFields
                  limit={palesLimit} setLimit={setPalesLimit}
                  fixed={palesFixed} setFixed={setPalesFixed}
                />
              </div>
            )}
          </div>
          
          {/* Billetes */}
          <div className="space-y-3">
            <div className="flex justify-between items-center border-b border-white/10 pb-1">
              <h4 className="text-xs font-mono font-extrabold uppercase text-primary">Billetes (4 cifras)</h4>
              <button 
                onClick={() => setBilletesEnabled(!billetesEnabled)}
                className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase transition-all border ${
                  billetesEnabled ? 'bg-green-500/20 border-green-500 text-green-500' : 'bg-red-500/20 border-red-500 text-red-500'
                }`}
              >
                {billetesEnabled ? 'Activado' : 'Desactivado'}
              </button>
            </div>
            
            {billetesEnabled && (
              <div className="space-y-2">
                {[1, 2, 3].map((prizeNum) => {
                  const pKey = `p${prizeNum}` as keyof typeof billeteMultipliers;
                  const prizes = billeteMultipliers[pKey];
                  const fields = [
                    ['full4', '4 cifras'],
                    ['first3', '3 primeras'],
                    ['last3', '3 últimas'],
                    ['first2', '2 primeras'],
                    ['last2', '2 últimas'],
                    ['last1', 'Última cifra'],
                  ] as const;
                  return (
                    <div key={prizeNum} className="bg-white/5 border border-white/10 p-3 rounded-xl space-y-2">
                      <h5 className="text-[11px] font-mono font-extrabold uppercase text-muted-foreground">{prizeNum === 1 ? '1er' : prizeNum === 2 ? '2do' : '3er'} premio</h5>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {fields.map(([field, label]) => {
                          const current = prizes[field];
                          return (
                            <div key={field} className="bg-black/20 px-2 py-1.5 rounded-lg">
                              <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground block truncate">{label}</label>
                              <input 
                                type="number" 
                                value={current === undefined || Number.isNaN(current) ? '' : current}
                                onChange={(e) => setBilleteMultipliers({
                                  ...billeteMultipliers, 
                                  [pKey]: { ...prizes, [field]: parseFloat(e.target.value) }
                                })}
                                className="w-full bg-transparent border-none p-0 text-sm font-bold focus:outline-none focus:ring-0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] font-semibold text-muted-foreground italic">Desglose de premios fijos según las cifras acertadas, en orden.</p>
                <ComboLimitFields
                  limit={billetesLimit} setLimit={setBilletesLimit}
                  fixed={billetesFixed} setFixed={setBilletesFixed}
                />
              </div>
            )}
          </div>
          
          </>)}

          <div className={`pt-4 grid gap-4 ${inline ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!inline && (
            <button 
              onClick={onClose}
              className="py-3 px-6 rounded-xl border border-border font-bold text-xs uppercase hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            )}
            <button 
              onClick={handleSave}
              className="py-3 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase hover:brightness-110 transition-all shadow-lg shadow-primary/20"
            >
              Guardar Ajustes
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const CheckoutModal = ({ show, customerName, setCustomerName, onConfirm, onClose, isSubmitting = false }: {
  show: boolean;
  customerName: string;
  setCustomerName: (val: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  isSubmitting?: boolean;
}) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-sm w-full rounded-2xl border border-white/10 bg-[#111827] p-4 shadow-2xl md:p-8"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black uppercase tracking-tighter italic">Finalizar Venta</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="            text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Nombre del Cliente
            </label>
            <input 
              type="text" 
              autoFocus
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Cliente General"
              disabled={isSubmitting}
              className="w-full bg-white/5 border border-border p-4 rounded-xl font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isSubmitting) onConfirm();
              }}
            />
            <p className="text-[11px] font-mono font-semibold text-muted-foreground italic">Deje en blanco para usar "Cliente General"</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={onClose}
              disabled={isSubmitting}
              className="py-4 px-6 rounded-xl border border-border font-bold text-xs uppercase hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
            <button 
              onClick={onConfirm}
              disabled={isSubmitting}
              className="py-4 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase hover:brightness-110 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Generando...' : 'Generar'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const getUserLabel = (u?: { name?: string; email?: string } | null) =>
  u?.email?.split('@')[0]?.trim() || u?.name?.trim() || '';

// Reloj del servidor: se calibra con la cabecera Date del hosting (sin lecturas de Firestore)
// y avanza con performance.now(), que no cambia si el usuario modifica la hora del dispositivo.
let serverClockBase: { server: number; perf: number } | null = null;

const serverNowMs = () => serverClockBase
  ? serverClockBase.server + (performance.now() - serverClockBase.perf)
  : Date.now();

const serverNow = () => new Date(serverNowMs());

const syncServerClock = async (): Promise<boolean> => {
  try {
    const perfStart = performance.now();
    const response = await fetch(`/time.txt?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    const dateHeader = response.headers.get('Date');
    const serverMs = dateHeader ? new Date(dateHeader).getTime() : NaN;
    if (!response.ok || Number.isNaN(serverMs)) return serverClockBase !== null;
    const perfEnd = performance.now();
    serverClockBase = { server: serverMs + (perfEnd - perfStart) / 2, perf: perfEnd };
    return true;
  } catch {
    return serverClockBase !== null;
  }
};

const getBusinessDate = (date = serverNow()) => {
  const hours = date.getHours();
  if (hours < 3) {
    const prevDate = new Date(date);
    prevDate.setDate(date.getDate() - 1);
    return prevDate;
  }
  return date;
};

const getStartOfBusinessDay = (date = serverNow()) => {
  const businessDate = getBusinessDate(date);
  const start = new Date(businessDate);
  start.setHours(3, 0, 0, 0);
  return start;
};

const getEndOfBusinessDay = (date = serverNow()) => {
  const start = getStartOfBusinessDay(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return end;
};

const cleanTextForExport = (text: unknown) => {
  if (text === undefined || text === null) return '';

  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^\p{L}\p{N}\s\-.,:/()]/gu, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const toPdfSafeText = (value: string) => value
  .normalize('NFC')
  .replace(/[\u00B7\u2022\u2013\u2014]/g, '-')
  .replace(/\u2192/g, '->')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[^\u0020-\u007E\u00A0-\u00FF\n]/g, '')
  .replace(/[ ]{2,}/g, ' ');

// jsPDF con fuentes estándar solo soporta Latin-1; cualquier otro carácter sale como símbolos raros.
const createReportPdf = () => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const originalText = pdf.text.bind(pdf) as (...args: any[]) => any;
  (pdf as any).text = (text: any, ...rest: any[]) => originalText(
    Array.isArray(text) ? text.map(t => toPdfSafeText(String(t))) : toPdfSafeText(String(text ?? '')),
    ...rest
  );
  return pdf;
};

const sharePdfDocument = async (pdf: jsPDF, fileName: string, title: string, text: string): Promise<'shared' | 'cancelled' | 'downloaded'> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: pdf.output('datauristring').split(',')[1],
        directory: Directory.Cache
      });
      await Share.share({ title, text, files: [savedFile.uri], dialogTitle: 'Compartir PDF' });
      return 'shared';
    } catch (error: any) {
      if (/cancel/i.test(String(error?.message || error))) return 'cancelled';
      console.error('Error sharing PDF natively:', error);
    }
  } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
      const payload = { title, text, files: [file] };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return 'shared';
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
      console.error('Error sharing PDF:', error);
    }
  }
  pdf.save(fileName);
  return 'downloaded';
};

const renderShareReceiptPng = async (data: {
  qrValue: string;
  headerLines: string[];
  sections: { title: string; items: { prefix: string; number: string; suffix: string }[] }[];
  txCode: string;
  prizeTotal: number;
  total: number;
}): Promise<string> => {
  const font = '"Courier New", Courier, monospace';
  const width = 440;
  const pad = 22;
  const lh = 26;
  const qrSize = 112;
  const rightX = width - pad;

  const qrSvg = renderToStaticMarkup(<QRCode value={data.qrValue} size={qrSize} />);
  const qrImage = await new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
  });

  type Part = { text: string; size: number; bold?: boolean };
  type Row = { text: string; bold?: boolean; align?: 'left' | 'center'; right?: string; gap?: number; parts?: Part[]; height?: number };
  const measureCtx = document.createElement('canvas').getContext('2d')!;
  const partsWidth = (parts: Part[]) => parts.reduce((sum, part) => {
    measureCtx.font = `${part.bold ? 'bold ' : ''}${part.size}px ${font}`;
    return sum + measureCtx.measureText(part.text).width;
  }, 0);
  const rows: Row[] = [];
  data.sections.forEach(section => {
    rows.push({ text: section.title, bold: true, gap: 8 });
    let current: Part[] = [];
    let count = 0;
    const flush = () => {
      if (current.length) rows.push({ text: '', parts: current, height: 32 });
      current = [];
      count = 0;
    };
    section.items.forEach(item => {
      const itemParts: Part[] = [
        { text: item.prefix.trim(), size: 18 },
        { text: item.number, size: 18, bold: true },
        { text: `${item.suffix} | `, size: 18 }
      ];
      if (count > 0 && partsWidth(current) + partsWidth(itemParts) > width - 28) flush();
      current.push(...itemParts);
      count += 1;
    });
    flush();
  });
  rows.push({ text: `TX: ${data.txCode.toLowerCase()}`, bold: true, right: `$${data.total.toFixed(2)}`, gap: 8 });
  rows.push({ text: '-'.repeat(32) });
  if (data.prizeTotal > 0) rows.push({ text: 'PREMIO TOTAL', bold: true, right: `$${data.prizeTotal.toFixed(2)}` });
  rows.push({ text: 'TOTAL', bold: true, right: `$${data.total.toFixed(2)}`, gap: 4 });
  rows.push({ text: '-'.repeat(32) });
  rows.push({ text: 'Sin comprobante no se pagan premios.', align: 'center', gap: 6 });
  rows.push({ text: 'GRACIAS POR SU COMPRA', align: 'center' });

  const headerHeight = Math.max(qrSize, data.headerLines.length * 20) + 14;
  const bodyHeight = rows.reduce((sum, row) => sum + (row.height || lh) + (row.gap || 0), 0);
  const height = pad + headerHeight + bodyHeight + pad;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';

  if (qrImage) ctx.drawImage(qrImage, pad, pad, qrSize, qrSize);
  const textX = pad + qrSize + 14;
  data.headerLines.forEach((headerLine, index) => {
    ctx.font = `bold 15px ${font}`;
    let text = headerLine;
    while (text.length > 1 && ctx.measureText(text).width > width - pad - textX) text = text.slice(0, -1);
    ctx.fillText(text, textX, pad + 10 + index * 20);
  });

  let y = pad + headerHeight;
  rows.forEach(row => {
    y += row.gap || 0;
    const rowHeight = row.height || lh;
    if (row.parts) {
      const trimmed = row.parts.slice();
      const lastPart = trimmed[trimmed.length - 1];
      trimmed[trimmed.length - 1] = { ...lastPart, text: lastPart.text.replace(/\s*\|\s*$/, '') };
      let x = (width - partsWidth(trimmed)) / 2;
      ctx.textAlign = 'left';
      trimmed.forEach(part => {
        ctx.font = `${part.bold ? 'bold ' : ''}${part.size}px ${font}`;
        ctx.fillText(part.text, x, y + rowHeight / 2);
        x += ctx.measureText(part.text).width;
      });
      y += rowHeight;
      return;
    }
    ctx.font = `${row.bold ? 'bold ' : ''}18px ${font}`;
    const centerY = y + lh / 2;
    if (row.align === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(row.text, width / 2, centerY);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(row.text, pad, centerY);
    }
    if (row.right) {
      ctx.textAlign = 'right';
      ctx.fillText(row.right, rightX, centerY);
    }
    ctx.textAlign = 'left';
    y += lh;
  });
  return canvas.toDataURL('image/png');
};

const shareImageFile = async (dataUrl: string, fileName: string, title: string, text?: string): Promise<'shared' | 'cancelled' | 'downloaded'> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: dataUrl.split(',')[1],
        directory: Directory.Cache
      });
      await Share.share({ title, text, files: [savedFile.uri], dialogTitle: title });
      return 'shared';
    } catch (error: any) {
      if (/cancel/i.test(String(error?.message || error))) return 'cancelled';
      console.error('Error sharing image natively:', error);
    }
  } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: 'image/png' });
      const payload = { title, text, files: [file] };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return 'shared';
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'cancelled';
      console.error('Error sharing image:', error);
    }
  }
  const link = document.createElement('a');
  link.download = fileName;
  link.href = dataUrl;
  link.click();
  return 'downloaded';
};

const UserModal = ({ show, userProfile, onSave, onClose, currentUserRole, canCreateProgramador = false }: {
  show: boolean;
  userProfile: UserProfile | null;
  onSave: (user: UserProfile, password?: string) => void;
  onClose: () => void;
  currentUserRole: string | undefined;
  canCreateProgramador?: boolean;
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'seller' | 'ceo' | 'programador'>('seller');
  const [commissionRate, setCommissionRate] = useState(10);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [canLiquidate, setCanLiquidate] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(60);
  const [sellerId, setSellerId] = useState('');

  useEffect(() => {
    if (userProfile) {
      setEmail(userProfile.email);
      setPassword('');
      setName(userProfile.name);
      setRole(userProfile?.role as 'admin' | 'seller' | 'ceo' | 'programador');
      setCommissionRate(userProfile.commissionRate);
      setStatus(userProfile.status);
      setCanLiquidate(userProfile.canLiquidate || false);
      setSessionTimeoutMinutes(userProfile.sessionTimeoutMinutes || 60);
      setSellerId(userProfile.sellerId || '');
    } else {
      setEmail('');
      setPassword('');
      setName('');
      setRole('seller');
      setCommissionRate(10);
      setStatus('active');
      setCanLiquidate(false);
      setSessionTimeoutMinutes(60);
      setSellerId('');
    }
  }, [userProfile, show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-md w-full p-4 md:p-8 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black uppercase tracking-tighter italic">{userProfile ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Usuario (sin espacios)</label>
            <input 
              type="text" 
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase().replace(/\s/g, ''))}
              disabled={!!userProfile}
              placeholder="ej. juanperez"
              className="w-full bg-white/5 border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
            />
          </div>

          {!userProfile && (
            <div className="space-y-2">
            <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Contraseña (opcional si ya existe en Auth)</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-white/5 border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          )}

          {!userProfile && (
            <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl">
              <p className="text-xs text-primary font-mono uppercase tracking-widest text-center">
                El ID de Vendedor y el Nombre se generarán automáticamente al guardar.
              </p>
            </div>
          )}

          {userProfile && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">ID Vendedor (Prefijo)</label>
                <input 
                  type="text" 
                  value={sellerId}
                  readOnly
                  className="w-full bg-white/5 border border-border p-3 rounded-xl font-mono text-sm opacity-50 cursor-not-allowed"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Nombre</label>
                <input 
                  type="text" 
                  value={name}
                  readOnly
                  className="w-full bg-white/5 border border-border p-3 rounded-xl font-mono text-sm opacity-50 cursor-not-allowed"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Rol</label>
            <select 
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'seller' | 'ceo' | 'programador')}
              disabled={currentUserRole !== 'ceo' && currentUserRole !== 'admin' && currentUserRole !== 'programador'}
              className="w-full bg-black border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
            >
              <option key="seller" value="seller" className="bg-gray-900">Vendedor</option>
              {(currentUserRole === 'ceo' || currentUserRole === 'admin') && <option key="admin" value="admin" className="bg-gray-900">Administrador</option>}
              {currentUserRole === 'ceo' && <option key="ceo" value="ceo" className="bg-gray-900">CEO</option>}
              {canCreateProgramador && <option key="programador" value="programador" className="bg-gray-900">Programador</option>}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Comisión (%)</label>
            <input 
              type="number" 
              value={Number.isNaN(commissionRate) ? '' : commissionRate}
              onChange={(e) => setCommissionRate(Number(e.target.value))}
              min="0"
              max="100"
              disabled={currentUserRole !== 'ceo'}
              className="w-full bg-white/5 border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <label className="            text-xs font-mono font-bold uppercase tracking-widest text-white/70">Estado</label>
            <select 
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
              className="w-full bg-black border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
            >
              <option key="active" value="active" className="bg-gray-900">Activo</option>
              <option key="inactive" value="inactive" className="bg-gray-900">Inactivo</option>
            </select>
          </div>

          {currentUserRole === 'ceo' && role === 'admin' && (
            <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-border mt-4">
              <input 
                type="checkbox" 
                id="canLiquidate"
                checked={canLiquidate}
                onChange={(e) => setCanLiquidate(e.target.checked)}
                className="w-5 h-5 rounded border-border bg-black text-primary focus:ring-primary focus:ring-offset-0"
              />
              <label htmlFor="canLiquidate" className="text-sm font-bold uppercase tracking-widest cursor-pointer">
                Permitir Liquidar a Otros
              </label>
            </div>
          )}

          {role === 'ceo' && (
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Tiempo de inactividad (minutos)</label>
              <input 
                type="number" 
                value={Number.isNaN(sessionTimeoutMinutes) ? '' : sessionTimeoutMinutes}
                onChange={(e) => setSessionTimeoutMinutes(Number(e.target.value))}
                min="1"
                className="w-full bg-white/5 border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          )}

          <button 
            onClick={() => {
              if (!email) {
                toast.error('Usuario es requerido');
                return;
              }
              if (!userProfile && password && password.length < 6) {
                toast.error('La contraseña debe tener al menos 6 caracteres');
                return;
              }
              onSave({ 
                email, 
                name: userProfile ? name : '', // Will be generated in saveUser
                role, 
                commissionRate, 
                status,
                canLiquidate: role === 'admin' ? canLiquidate : false,
                currentDebt: userProfile?.currentDebt || 0,
                sessionTimeoutMinutes: role === 'ceo' ? sessionTimeoutMinutes : undefined,
                sellerId
              }, password);
            }}
            className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold uppercase tracking-widest hover:brightness-110 transition-all mt-6"
          >
            {userProfile ? 'Guardar Cambios' : 'Crear Usuario'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const FastEntryModal = ({ show, onAdd, onClose, selectedLotteries, chancePrice, plAmount, comboType }: {
  comboType: 'PL' | 'BL';
  show: boolean;
  onAdd: (bets: Bet[]) => void;
  onClose: () => void;
  selectedLotteries: string[];
  chancePrice: number;
  plAmount: string;
}) => {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{valid: Bet[], invalid: string[]}>({valid: [], invalid: []});
  const [invertFormat, setInvertFormat] = useState(false);

  useEffect(() => {
    if (!show) {
      setText('');
      setPreview({valid: [], invalid: []});
      setInvertFormat(false);
    }
  }, [show]);

  const processText = () => {
    if (selectedLotteries.length === 0) {
      toast.error('Seleccione al menos un sorteo primero');
      return;
    }

    // Normalizar espacios alrededor de los separadores (- o .)
    const normalizedText = text.replace(/\s*([-.,])\s*/g, '$1');
    const tokens = normalizedText.split(/\s+/).filter(t => t.trim() !== '');
    const validBets: Bet[] = [];
    const invalidTokens: string[] = [];
    const plCostPerUnit = parseFloat(plAmount) || 1.00;

    tokens.forEach(token => {
      // Matches formats like 87-3, 5-34, 88.3, 1123-2, 8939.4, 87,3
      // We use a more generic regex to capture both sides, then assign based on invertFormat
      const match = token.match(/^(\d+(?:[.,]\d+)?)[-.,](\d+(?:[.,]\d+)?)$/);
      if (match) {
        let numStr = invertFormat ? match[2] : match[1];
        let qtyStrRaw = invertFormat ? match[1] : match[2];
        
        // Clean up numStr just in case it captured decimals (though numbers shouldn't have them)
        numStr = numStr.replace(/[.,].*$/, '');
        
        const qtyStr = qtyStrRaw.replace(',', '.');
        const quantity = parseInt(qtyStr, 10);

        if (quantity > 0 && numStr.length >= 1 && numStr.length <= 4) {
          let type: 'CH' | 'PL' | 'BL' = 'CH';
          let finalNumber = numStr;
          let calculatedAmount = 0;

          if (numStr.length <= 2) {
            type = 'CH';
            finalNumber = numStr.padStart(2, '0');
            calculatedAmount = quantity * chancePrice;
          } else {
            type = comboType;
            finalNumber = numStr.padStart(4, '0');
            calculatedAmount = quantity * plCostPerUnit;
          }

          {
            selectedLotteries.forEach(lottery => {
              const existingIdx = validBets.findIndex(b => 
                b.number === finalNumber && 
                b.lottery === lottery && 
                b.type === type
              );
              if (existingIdx !== -1) {
                validBets[existingIdx].quantity += quantity;
                validBets[existingIdx].amount += calculatedAmount;
              } else {
                validBets.push({
                  number: finalNumber,
                  lottery,
                  amount: calculatedAmount,
                  type,
                  quantity,
                  ...(type === 'CH' ? { price: chancePrice } : {})
                });
              }
            });
          }
        } else {
          invalidTokens.push(token);
        }
      } else {
        invalidTokens.push(token);
      }
    });

    setPreview({ valid: validBets, invalid: invalidTokens });
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="glass-card max-w-2xl w-full p-4 md:p-8 max-h-[95vh] flex flex-col"
      >
        <div className="flex justify-between items-center mb-4 md:mb-6">
          <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter italic">Copiado Rápido</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs font-semibold text-muted-foreground font-mono mb-4">
          Pegue su lista de números y montos. Formatos soportados: 87-3, 5-34, 88.3, 1123-2, 8939.4. Separados por espacios o saltos de línea.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 bg-white/5 p-3 rounded-xl border border-border">
          <span className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
            Formato: {invertFormat ? 'Cantidad-Número' : 'Número-Cantidad'}
          </span>
          <button
            onClick={() => setInvertFormat(!invertFormat)}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-extrabold uppercase transition-all ${
              invertFormat ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <ArrowLeftRight className="w-3 h-3" />
            Invertir
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full h-32 bg-black/40 border border-border p-4 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all resize-none mb-4"
          placeholder={invertFormat ? "Ejemplo: 3-87 2-56 2-1123..." : "Ejemplo: 87-3 56-2 1123-2..."}
        />

        <button 
          onClick={processText}
          className="w-full bg-white/10 text-white py-3 rounded-xl font-bold uppercase tracking-widest hover:bg-white/20 transition-all mb-6"
        >
          Procesar Texto
        </button>

        {preview.valid.length > 0 && (
          <div className="flex-1 overflow-y-auto mb-6 bg-black/20 rounded-xl p-4 border border-border/50">
            <h4 className="text-sm font-bold text-green-400 mb-2">Apuestas Válidas ({preview.valid.length / selectedLotteries.length} números x {selectedLotteries.length} sorteos)</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {preview.valid.slice(0, 20).map((bet, i) => (
                <div key={i} className="text-xs font-mono bg-white/5 p-2 rounded border border-border/50 flex justify-between items-center">
                  <span className="font-bold">{bet.number}</span>
                  <div className="text-right">
                    <span className="text-xs font-bold text-muted-foreground mr-2">x{bet.quantity}</span>
                    <span className="text-primary">${bet.amount.toFixed(2)}</span>
                  </div>
                </div>
              ))}
              {preview.valid.length > 20 && (
                <div className="text-xs font-mono text-muted-foreground p-2 col-span-full">...y {preview.valid.length - 20} más</div>
              )}
            </div>
          </div>
        )}

        {preview.invalid.length > 0 && (
          <div className="mb-6 bg-red-500/10 rounded-xl p-4 border border-red-500/20">
            <h4 className="text-sm font-bold text-red-400 mb-2">Formatos Inválidos ({preview.invalid.length})</h4>
            <div className="flex flex-wrap gap-2">
              {preview.invalid.map((token, i) => (
                <span key={i} className="text-xs font-mono bg-red-500/20 text-red-300 px-2 py-1 rounded">{token}</span>
              ))}
            </div>
          </div>
        )}

        <button 
          onClick={() => {
            if (preview.valid.length > 0) {
              onAdd(preview.valid);
              onClose();
            } else {
              toast.error('No hay apuestas válidas para agregar');
            }
          }}
          disabled={preview.valid.length === 0}
          className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-50"
        >
          Agregar al Panel ({preview.valid.length})
        </button>
      </motion.div>
    </div>
  );
};

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

interface LotteryStatsCardProps {
  lottery: Lottery;
  tickets: LotteryTicket[];
  userProfile: UserProfile | null;
  users: UserProfile[];
  results: LotteryResult[];
  historyDate: string;
  selectedUserEmail: string;
  globalSettings: GlobalSettings;
}

const LotteryStatsCard: React.FC<LotteryStatsCardProps> = ({ 
  lottery, 
  tickets, 
  userProfile, 
  users, 
  results, 
  historyDate,
  selectedUserEmail,
  globalSettings
}) => {
  const [expanded, setExpanded] = useState(false);
  const [tappedCell, setTappedCell] = useState<number | null>(null);

  const lotteryTickets = useMemo(() => {
    return tickets.filter(t => t.bets && t.bets.some(b => b.lottery === lottery.name) && t.status !== 'cancelled');
  }, [tickets, lottery.name]);

  const visibleTickets = useMemo(() => {
    let filtered = lotteryTickets;
    if (userProfile?.role === 'seller') {
      filtered = filtered.filter(t => t.sellerEmail?.toLowerCase() === userProfile.email?.toLowerCase());
    } else if (selectedUserEmail !== '') {
      filtered = filtered.filter(t => t.sellerEmail?.toLowerCase() === selectedUserEmail?.toLowerCase());
    }
    return filtered;
  }, [lotteryTickets, userProfile, selectedUserEmail]);

  const visibleBets = useMemo(() => {
    return visibleTickets.flatMap(t => t.bets.filter(b => b.lottery === lottery.name));
  }, [visibleTickets, lottery.name]);

  const totalSales = visibleBets.reduce((sum, b) => sum + (b.amount || 0), 0);
  const totalPlays = visibleBets.length;
  
  const heatmapData = useMemo(() => {
    const data = new Array(100).fill(null).map(() => ({ amount: 0, count: 0 }));
    visibleBets.forEach(b => {
      if (b.type === 'CH' && b.number && b.number.length === 2) {
        const num = parseInt(b.number, 10);
        if (!isNaN(num) && num >= 0 && num <= 99) {
          data[num].amount += b.amount || 0;
          data[num].count += 1;
        }
      }
    });
    return data;
  }, [visibleBets]);

  const maxVolume = Math.max(...heatmapData.map(d => d.count), 1);

  const pales = visibleBets.filter(b => b.type === 'PL');
  const billetes = visibleBets.filter(b => b.type === 'BL');

  const groupedPales = useMemo(() => {
    const groups: Record<string, { count: number, amount: number }> = {};
    pales.forEach(b => {
      if (!b.number) return;
      if (!groups[b.number]) groups[b.number] = { count: 0, amount: 0 };
      groups[b.number].count += 1;
      groups[b.number].amount += b.amount || 0;
    });
    return Object.entries(groups).map(([number, data]) => ({ number, ...data })).sort((a, b) => b.amount - a.amount);
  }, [pales]);

  const groupedBilletes = useMemo(() => {
    const groups: Record<string, { count: number, amount: number }> = {};
    billetes.forEach(b => {
      if (!b.number) return;
      if (!groups[b.number]) groups[b.number] = { count: 0, amount: 0 };
      groups[b.number].count += 1;
      groups[b.number].amount += b.amount || 0;
    });
    return Object.entries(groups).map(([number, data]) => ({ number, ...data })).sort((a, b) => b.amount - a.amount);
  }, [billetes]);

  const userBreakdown = useMemo(() => {
    if (userProfile?.role === 'seller') return [];
    const breakdown: Record<string, number> = {};
    lotteryTickets.forEach(t => {
      const tBets = t.bets.filter(b => b.lottery === lottery.name);
      const tAmount = tBets.reduce((sum, b) => sum + (b.amount || 0), 0);
      if (tAmount > 0) {
        breakdown[t.sellerEmail || 'Unknown'] = (breakdown[t.sellerEmail || 'Unknown'] || 0) + tAmount;
      }
    });
    return Object.entries(breakdown).map(([email, amount]) => ({
      email,
      name: getUserLabel(users.find(u => u.email === email) || { email }),
      amount
    })).sort((a, b) => b.amount - a.amount);
  }, [lotteryTickets, userProfile, users, lottery.name]);

  const result = results.find(r => r.lotteryName === lottery.name && r.date === historyDate);
  const hasResult = !!result;
  const cardBgClass = hasResult ? 'bg-[#3F1616]/80 border-[#7F1D1D]/60' : 'bg-[#111827] border-gray-800';

  return (
    <div className={`rounded-xl border ${cardBgClass} overflow-hidden transition-all duration-300 mb-4`}>
      <div 
        className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors flex justify-between items-center gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-base font-bold text-[#E5E7EB] tracking-wide">{cleanText(lottery.name)}</h3>
            <div className="flex items-center gap-2 text-sm text-[#9CA3AF] mt-1 font-normal">
              <span>{lottery.drawTime || 'Sin horario'}</span>
              <span>•</span>
              <span>{historyDate}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 text-right">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="text-xs text-[#9CA3AF] font-bold tracking-wider uppercase">Precio</span>
            <span className="text-base font-semibold text-[#34D399]">${totalSales.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs text-[#9CA3AF] font-bold tracking-wider uppercase">PZS</span>
            <span className="text-base font-semibold text-[#E5E7EB]">{totalPlays}</span>
          </div>
          <ChevronDown className={`w-5 h-5 text-[#9CA3AF] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-800/50 overflow-hidden"
          >
            <div className="p-4 space-y-6">
              
              {/* Resultados */}
              {result && (
                <div className="flex gap-4 justify-start items-center">
                  <div className="flex flex-col items-center">
                    <span className="text-xs font-bold text-[#9CA3AF] mb-1">1RO</span>
                    <span className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-sm font-semibold px-3 py-1 rounded-md min-w-[2.5rem] text-center">
                      {result.firstPrize}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-xs font-bold text-[#9CA3AF] mb-1">2DO</span>
                    <span className="bg-gray-500/10 border border-gray-500/30 text-gray-300 text-sm font-semibold px-3 py-1 rounded-md min-w-[2.5rem] text-center">
                      {result.secondPrize}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-xs font-bold text-[#9CA3AF] mb-1">3RO</span>
                    <span className="bg-orange-500/10 border border-orange-500/30 text-orange-400 text-sm font-semibold px-3 py-1 rounded-md min-w-[2.5rem] text-center">
                      {result.thirdPrize}
                    </span>
                  </div>
                </div>
              )}

              {/* Heatmap */}
              <div>
                <div className="grid grid-cols-10 gap-1">
                  {heatmapData.map((data, index) => {
                    const numStr = index.toString().padStart(2, '0');
                    const isFirst = result?.firstPrize ? result.firstPrize.slice(-2) === numStr : false;
                    const isSecond = result?.secondPrize ? result.secondPrize.slice(-2) === numStr : false;
                    const isThird = result?.thirdPrize ? result.thirdPrize.slice(-2) === numStr : false;
                    
                    const isWinner = isFirst || isSecond || isThird;
                    
                    let bgColor = 'bg-[#1F2937]/30';
                    let textColor = 'text-[#9CA3AF]';
                    let borderClass = 'border-transparent';
                    
                    if (data.count > 0) {
                      const intensity = 0.15 + (data.count / maxVolume) * 0.85;
                      bgColor = `rgba(34, 197, 94, ${intensity * 0.3})`;
                      textColor = 'text-[#34D399]';
                    }

                    let prizeAmount = 0;
                    let potentialPrize = 0;
                    
                    if (data.count > 0) {
                      visibleBets.forEach(b => {
                        if (b.type === 'CH' && b.number === numStr) {
                          const pricePerChance = lottery.pricePerUnit || 0.25;
                          const quantity = (b.amount || 0) / pricePerChance;
                          const priceConfig = globalSettings.chancePrices?.find(cp => Math.abs(cp.price - pricePerChance) < 0.001);
                          
                          potentialPrize += (priceConfig?.ch1 || 0) * quantity;
                          if (isFirst) prizeAmount += (priceConfig?.ch1 || 0) * quantity;
                          if (isSecond) prizeAmount += (priceConfig?.ch2 || 0) * quantity;
                          if (isThird) prizeAmount += (priceConfig?.ch3 || 0) * quantity;
                        }
                      });
                    }

                    const isLoss = prizeAmount > data.amount;

                    if (isWinner) {
                      borderClass = isFirst ? 'border-yellow-500/50' : isSecond ? 'border-gray-400/50' : 'border-orange-500/50';
                      textColor = isFirst ? 'text-yellow-500' : isSecond ? 'text-gray-300' : 'text-orange-400';
                      if (data.count > 0) {
                        // Highlight if winning number has sales
                        bgColor = isFirst ? 'bg-yellow-500/10' : isSecond ? 'bg-gray-500/10' : 'bg-orange-500/10';
                      }
                    }
                    
                    const isTapped = tappedCell === index;
                    const displayPrize = isWinner ? prizeAmount : potentialPrize;
                    const prizeLabel = isWinner ? 'Premio' : 'Paga';

                    return (
                      <div 
                        key={index}
                        onClick={() => {
                          if (data.count > 0) {
                            setTappedCell(isTapped ? null : index);
                          }
                        }}
                        className={`aspect-square flex flex-col items-center justify-center rounded border ${borderClass} ${bgColor} transition-colors relative ${data.count > 0 ? 'cursor-pointer' : ''}`}
                      >
                        {isLoss && data.count > 0 && !isTapped && (
                          <div className="absolute -top-2 -right-2 bg-[#111827] text-yellow-500 text-[10px] font-bold px-1 rounded border border-yellow-500/50 z-10 whitespace-nowrap">
                            (+${prizeAmount.toFixed(0)})
                          </div>
                        )}
                        
                        {isTapped ? (
                          <div className="flex flex-col items-center justify-center animate-in fade-in zoom-in duration-200">
                            <span className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-0.5">{prizeLabel}</span>
                            <span className={`text-xs font-extrabold ${isWinner ? textColor : 'text-[#34D399]'}`}>
                              ${displayPrize.toFixed(0)}
                            </span>
                          </div>
                        ) : (
                          <>
                            <span className={`text-sm font-bold leading-none ${textColor}`}>
                              {numStr}
                            </span>
                            {data.count > 0 && (
                              <span className={`text-xs mt-1 font-semibold ${isWinner ? textColor : 'text-[#34D399]/70'}`}>
                                {data.count}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pales y Billetes */}
              {(groupedPales.length > 0 || groupedBilletes.length > 0) && (
                <div className="border-t border-gray-800/50 pt-6 mt-6">
                  <h4 className="text-sm font-bold text-[#E5E7EB] mb-4 text-center tracking-widest">COMBINACIONES VENDIDAS</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {groupedPales.length > 0 && (
                      <div>
                        <h5 className="text-xs font-extrabold text-white/70 uppercase tracking-wider mb-3 border-b border-gray-800/50 pb-2">PALES:</h5>
                        <div className="space-y-2">
                          {groupedPales.map(p => (
                            <div key={p.number} className="flex justify-between items-center bg-[#1F2937]/20 px-3 py-2 rounded">
                              <span className="text-sm font-bold text-[#E5E7EB]">{p.number}</span>
                              <div className="flex items-center gap-4">
                                <span className="text-xs text-[#9CA3AF]">{p.count}x</span>
                                <span className="text-sm font-semibold text-[#34D399]">${p.amount.toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {groupedBilletes.length > 0 && (
                      <div>
                        <h5 className="text-xs font-extrabold text-white/70 uppercase tracking-wider mb-3 border-b border-gray-800/50 pb-2">BILLETES:</h5>
                        <div className="space-y-2">
                          {groupedBilletes.map(b => (
                            <div key={b.number} className="flex justify-between items-center bg-[#1F2937]/20 px-3 py-2 rounded">
                              <span className="text-sm font-bold text-[#E5E7EB]">{b.number}</span>
                              <div className="flex items-center gap-4">
                                <span className="text-xs text-[#9CA3AF]">{b.count}x</span>
                                <span className="text-sm font-semibold text-[#34D399]">${b.amount.toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Ventas por usuario */}
              {userProfile?.role !== 'seller' && userBreakdown.length > 0 && (
                <div className="bg-[#1F2937]/30 rounded-lg p-4 border border-gray-800/50">
                  <h4 className="text-xs font-extrabold text-white/70 uppercase tracking-wider mb-3">Ventas por Usuario</h4>
                  <div className="space-y-3">
                    {userBreakdown.map((ub) => (
                      <div key={ub.email} className="flex justify-between items-center">
                        <span className="text-sm font-normal text-[#E5E7EB]">{ub.name}</span>
                        <span className="text-sm font-bold text-green-400">${ub.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const cleanText = (text: string) => {
  if (!text) return '';
  // Replace common corrupted patterns found in the database
  // More aggressive regex to catch variations of the corrupted characters
  return text
    .replace(/[\u00D8\u00DD<][^a-zA-Z0-9\s()\-:/]*/g, 'Lotería')
    .replace(/Lotería+/g, 'Lotería')
    .replace(/Lotería\s+Lotería/g, 'Lotería')
    .trim();
};

const normalizePlainText = (text: string) => {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
};

const normalizeLotteryName = (name: string) => cleanText(name || '').trim().toLowerCase();

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null | undefined>(undefined);

  const getCurrentOperationalSessionDay = () => format(getBusinessDate(), 'yyyy-MM-dd');
  const getStoredSessionDay = () => localStorage.getItem('sessionBusinessDay');
  const markSessionDay = () => localStorage.setItem('sessionBusinessDay', getCurrentOperationalSessionDay());
  const clearSessionDay = () => localStorage.removeItem('sessionBusinessDay');
  const enforceSessionByOperationalDay = false;
  const autoResetStateOnBusinessDayChange = false;
  const isSessionValid = () => {
    const storedDay = getStoredSessionDay();
    if (!storedDay) return true;
    return storedDay === getCurrentOperationalSessionDay();
  };

  const [tick, setTick] = useState(0);
  useEffect(() => {
    void syncServerClock();
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    const clockInterval = setInterval(() => { void syncServerClock(); }, 5 * 60000);
    return () => { clearInterval(interval); clearInterval(clockInterval); };
  }, []);

  const businessDayKey = useMemo(() => format(getBusinessDate(), 'yyyy-MM-dd'), [tick]);
  const canUseGlobalScope = userProfile?.role === 'ceo' || userProfile?.role === 'programador' || !!userProfile?.canLiquidate;
  const [showGlobalScope, setShowGlobalScope] = useState(false);

  const [loading, setLoading] = useState(true);

  const handleLogout = () => {
    signOut(auth);
    clearSessionDay();
  };

  const [tickets, setTickets] = useState<LotteryTicket[]>([]);
  const [historyTickets, setHistoryTickets] = useState<LotteryTicket[]>([]);
  const [historySellerEmail, setHistorySellerEmail] = useState('');
  const enableShowAllToday = false;
  const [lotteries, setLotteries] = useState<Lottery[]>([]);
  const [results, setResults] = useState<LotteryResult[]>([]);
  const [activeTab, setActiveTab] = useState<'sales' | 'history' | 'admin' | 'dashboard' | 'results' | 'users' | 'liquidaciones' | 'config' | 'archivo' | 'stats' | 'cierres' | 'recovery'>('history');
  useEffect(() => {
    setReadMeterContext(activeTab, userProfile?.role);
  }, [activeTab, userProfile?.role]);
  useEffect(() => {
    if (userProfile?.email) startReadMeterSync(userProfile.email);
  }, [userProfile?.email]);
  const canAccessManagedUsersData = (canUseGlobalScope && (activeTab === 'users' || activeTab === 'liquidaciones' || activeTab === 'archivo' || activeTab === 'recovery'))
    || (activeTab === 'dashboard' && (canUseGlobalScope || userProfile?.role === 'admin'));
  const canViewOtherSellersHistory = userProfile?.role === 'ceo' || userProfile?.role === 'admin' || userProfile?.role === 'programador';
  const historyViewingOtherSeller = activeTab === 'history' && canViewOtherSellersHistory && !!historySellerEmail;
  const canAccessAllUsers = canAccessManagedUsersData || historyViewingOtherSeller || (canUseGlobalScope && showGlobalScope && (activeTab === 'stats' || activeTab === 'cierres'));
  const isGlobalTicketFeedView = ['ceo', 'admin', 'programador'].includes(userProfile?.role || '')
    && ['dashboard', 'stats', 'cierres'].includes(activeTab);
  const ticketFeedIsGlobal = canAccessAllUsers || isGlobalTicketFeedView;
  const [expandedStats, setExpandedStats] = useState<string[]>([]);
  const [statsReportFilter, setStatsReportFilter] = useState<StatsReportFilter>('global');
  const [isGeneratingStatsReport, setIsGeneratingStatsReport] = useState(false);
  const [expandedCierres, setExpandedCierres] = useState<string[]>([]);
  const [cierreLottery, setCierreLottery] = useState<string>('');
  const cierreRef = useRef<HTMLDivElement>(null);
  const [archiveUserEmail, setArchiveUserEmail] = useState('');
  const [archiveDate, setArchiveDate] = useState<string>(() => {
    const d = getBusinessDate();
    d.setDate(d.getDate() - 1);
    return format(d, 'yyyy-MM-dd');
  });
  const [archiveTickets, setArchiveTickets] = useState<LotteryTicket[]>([]);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [recoveryDate, setRecoveryDate] = useState(format(getBusinessDate(), 'yyyy-MM-dd'));
  const [recoveryTickets, setRecoveryTickets] = useState<RecoveryTicketRecord[]>([]);
    const [exportRecoveryList, setExportRecoveryList] = useState<RecoveryTicketRecord[] | null>(null);
    const [isExportingRecovery, setIsExportingRecovery] = useState(false);
    const exportRefsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);
  const [recoverySavingRowId, setRecoverySavingRowId] = useState<string | null>(null);
  const [recoveryDeletingRowId, setRecoveryDeletingRowId] = useState<string | null>(null);
  const [recoverySellerFilter, setRecoverySellerFilter] = useState('');
  const [recoveryLotteryFilter, setRecoveryLotteryFilter] = useState('');
  const [recoveryTicketIdFilter, setRecoveryTicketIdFilter] = useState('');
  const [recoveryStatusFilter, setRecoveryStatusFilter] = useState<'ALL' | 'active' | 'winner' | 'cancelled' | 'liquidated'>('ALL');
  const [recoverySortOrder, setRecoverySortOrder] = useState<'asc' | 'desc'>('asc');
  const [recoveryTargetLotteryByRow, setRecoveryTargetLotteryByRow] = useState<Record<string, string>>({});
  const [recoveryTargetLotteryMapByRow, setRecoveryTargetLotteryMapByRow] = useState<Record<string, Record<string, string>>>({});
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [bluetoothPrinterConfig, setBluetoothPrinterConfig] = useState<BluetoothPrinterConfig | null>(() => getSavedBluetoothPrinterConfig());
  const [selectedBluetoothPrinterProfileId, setSelectedBluetoothPrinterProfileId] = useState(() => getSavedBluetoothPrinterConfig()?.profileId || BLUETOOTH_PRINTER_PROFILES[0].id);
  const [selectedPrinterPaperWidth, setSelectedPrinterPaperWidth] = useState<PrinterPaperWidth>(() => getSavedBluetoothPrinterConfig()?.paperWidth || '58');
  const [isConnectingPrinter, setIsConnectingPrinter] = useState(false);
  const [nativeBluetoothPrinters, setNativeBluetoothPrinters] = useState<NativeBluetoothPrinterDevice[]>([]);
  const [selectedNativePrinterAddress, setSelectedNativePrinterAddress] = useState(() => getSavedBluetoothPrinterConfig()?.deviceAddress || '');
  const [isLoadingNativePrinters, setIsLoadingNativePrinters] = useState(false);

  useEffect(() => {
    if (!userProfile) return;
    if (userProfile?.role === 'ceo' || userProfile?.role === 'admin' || userProfile?.role === 'programador') {
      setActiveTab('dashboard');
    } else {
      setActiveTab('sales');
    }
  }, [userProfile?.role]);

  useEffect(() => {
    if (!canUseGlobalScope && showGlobalScope) {
      setShowGlobalScope(false);
    }
  }, [canUseGlobalScope, showGlobalScope]);

  const [historyFilter, setHistoryFilter] = useState<'TODO' | 'CHANCE' | 'BILLETE' | 'PALE'>('TODO');
  const [showTicketModal, setShowTicketModal] = useState<{ ticket: LotteryTicket, selectedLotteryName?: string } | null>(null);
  const [numberTicketsModal, setNumberTicketsModal] = useState<{ lotteryName: string; type: 'CH' | 'PL' | 'BL'; number: string; rows: Array<{ ticket: LotteryTicket; amount: number; quantity: number }> } | null>(null);
  const [showTicketScanner, setShowTicketScanner] = useState(false);
  const [showLotteryModal, setShowLotteryModal] = useState<boolean>(false);
  const [editingResult, setEditingResult] = useState<LotteryResult | null>(null);
  const [resultEditorOpen, setResultEditorOpen] = useState(false);
  const [resultFormLotteryId, setResultFormLotteryId] = useState('');
  const [resultFormFirstPrize, setResultFormFirstPrize] = useState('');
  const [resultFormSecondPrize, setResultFormSecondPrize] = useState('');
  const [resultFormThirdPrize, setResultFormThirdPrize] = useState('');
  const [historyDate, setHistoryDate] = useState(format(getBusinessDate(), 'yyyy-MM-dd'));
  const [editingLottery, setEditingLottery] = useState<Lottery | null>(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [expandedLotteries, setExpandedLotteries] = useState<string[]>([]);
  const [lotteryPages, setLotteryPages] = useState<Record<string, number>>({});
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  
  const selectableUsers = useMemo(() => {
    return users.filter(u => {
      if (!u || !u.email || u.status !== 'active') return false;
      if (u.role === 'programador' && userProfile?.role !== 'programador') return false;

      const currentEmail = userProfile?.email?.toLowerCase();
      const targetEmail = u.email?.toLowerCase();

      if (userProfile?.role === 'ceo' || userProfile?.role === 'programador') {
        return ['ceo', 'admin', 'seller', 'programador'].includes(u.role) && targetEmail !== currentEmail;
      }

      if (userProfile?.role === 'admin') {
        return ['ceo', 'admin', 'seller', 'programador'].includes(u.role) && targetEmail !== currentEmail;
      }

      return false;
    });
  }, [users, userProfile]);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [historySettlements, setHistorySettlements] = useState<Settlement[]>([]);
  const [historyResults, setHistoryResults] = useState<LotteryResult[]>([]);
  const [liquidationTicketsSnapshot, setLiquidationTicketsSnapshot] = useState<LotteryTicket[]>([]);
  const [liquidationResultsSnapshot, setLiquidationResultsSnapshot] = useState<LotteryResult[]>([]);
  const [liquidationSettlementsSnapshot, setLiquidationSettlementsSnapshot] = useState<Settlement[]>([]);
  const [isLiquidationDataLoading, setIsLiquidationDataLoading] = useState(false);
  const [selectedUserToLiquidate, setSelectedUserToLiquidate] = useState<string>('__ALL__');
  const [liquidationDate, setLiquidationDate] = useState<string>(format(getBusinessDate(), 'yyyy-MM-dd'));
  const [liquidationEndDate, setLiquidationEndDate] = useState<string>('');
  const [isSharingLiquidation, setIsSharingLiquidation] = useState(false);
  const liquidationDayCacheRef = useRef<Map<string, { tickets: LotteryTicket[]; results: LotteryResult[] }>>(new Map());
  const primaryCeoEmail = (import.meta.env.VITE_CEO_EMAIL || 'zsayeth09@gmail.com').toLowerCase();
  const isPrimaryCeoUser = (userProfile?.email || '').toLowerCase() === primaryCeoEmail;
  const canViewPaleSimulation = isPrimaryCeoUser || userProfile?.role === 'programador';
  const historyDataCacheRef = useRef<Map<string, {
    tickets: LotteryTicket[];
    settlements: Settlement[];
    results: LotteryResult[];
  }>>(new Map());
  const autoCleanupRunningRef = useRef(false);
  const closedLotteryCardsCacheRef = useRef<Map<string, {
    sales: number;
    commissions: number;
    prizes: number;
    netProfit: number;
    sortedTicketsForLot: Array<{ t: LotteryTicket; prize: number }>;
  }>>(new Map());

  useEffect(() => {
    if (userProfile && userProfile.role === 'seller' && user?.email) {
      setSelectedUserToLiquidate(user?.email || '');
      setArchiveUserEmail(user?.email || '');
    }
  }, [userProfile, user?.email]);

  const previousBusinessDayRef = useRef(businessDayKey);

  useEffect(() => {
    if (!autoResetStateOnBusinessDayChange) {
      previousBusinessDayRef.current = businessDayKey;
      return;
    }
    if (previousBusinessDayRef.current === businessDayKey) return;

    const previousBusinessDay = previousBusinessDayRef.current;
    previousBusinessDayRef.current = businessDayKey;

    setTickets([]);
    setHistoryTickets([]);
    setArchiveTickets([]);
    setSettlements([]);
    setHistorySettlements([]);
    setHistoryResults([]);
    setLiquidationTicketsSnapshot([]);
    setLiquidationResultsSnapshot([]);
    historyDataCacheRef.current.clear();liquidationDayCacheRef.current.clear();
    closedLotteryCardsCacheRef.current.clear();

    if (historyDate === previousBusinessDay) setHistoryDate(businessDayKey);
    if (archiveDate === previousBusinessDay) setArchiveDate(businessDayKey);
    if (liquidationDate === previousBusinessDay) setLiquidationDate(businessDayKey);
    if (recoveryDate === previousBusinessDay) setRecoveryDate(businessDayKey);

    if (userProfile?.role === 'seller' && user?.email) {
      setArchiveUserEmail(user.email.toLowerCase());
      setSelectedUserToLiquidate(user.email.toLowerCase());
    }

    toast.info(`Nuevo día operativo iniciado: ${businessDayKey}`);
  }, [archiveDate, autoResetStateOnBusinessDayChange, businessDayKey, historyDate, liquidationDate, recoveryDate, user?.email, userProfile?.role]);

    useEffect(() => {
      if (userProfile?.role === 'ceo' || userProfile?.role === 'admin' || userProfile?.role === 'programador') {
      console.log("Fetching all users for role:", userProfile.role);
      const q = query(collection(db, 'users'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        console.log("Users fetched successfully:", snapshot.size);
        const docs = snapshot.docs.map(doc => doc.data() as UserProfile);
        setUsers(docs);
      }, (error) => {
        console.error("Error fetching users:", error);
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
      return () => unsubscribe();
    }
  }, [userProfile?.role]);

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });
  const [reuseModal, setReuseModal] = useState<{
    show: boolean;
    ticket: LotteryTicket | null;
  }>({ show: false, ticket: null });

  // Form state
  const [number, setNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [isAmountSelected, setIsAmountSelected] = useState(false);
  const [plAmount, setPlAmount] = useState('1.00');
  const [betType, setBetType] = useState<'CH' | 'PL' | 'BL'>('CH');
  const [chancePrice, setChancePrice] = useState<number>(0.20);
  const [showChancePriceMenu, setShowChancePriceMenu] = useState(false);
  const [globalChancePriceFilter, setGlobalChancePriceFilter] = useState<string>('');
  const [selectedLottery, setSelectedLottery] = useState('');
  const [cart, setCart] = useState<Bet[]>([]);
  const cartTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.amount, 0);
  }, [cart]);
  const [multiLottery, setMultiLottery] = useState<string[]>([]);
  const [isMultipleMode, setIsMultipleMode] = useState(false);
  const [showMultiSelect, setShowMultiSelect] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [showFastEntryModal, setShowFastEntryModal] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    id: 'global',
    chancePrices: [
      { price: 0.20, ch1: 14, ch2: 3, ch3: 2 },
      { price: 0.25, ch1: 11, ch2: 3, ch3: 2 }
    ],
    palesEnabled: true,
    billetesEnabled: true,
    pl12Multiplier: 1000,
    pl13Multiplier: 1000,
    pl23Multiplier: 200,
    nextSellerNumber: 2
  });
  const [paleSimulationSettings, setPaleSimulationSettings] = useState<PaleSimulationSettings>({
    enabled: false,
    multiplier: null
  });
  const [paleSimulationMultiplierInput, setPaleSimulationMultiplierInput] = useState('');
  const [isSavingPaleSimulation, setIsSavingPaleSimulation] = useState(false);
  const [configSection, setConfigSection] = useState<'chances' | 'especiales' | 'dispositivos' | 'perfil'>('perfil');

  const Cursor = () => <span className="w-[2px] h-6 bg-primary animate-blink inline-block align-middle ml-0.5" />;

  // Refs for auto-focus
  const numberInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const saleInFlightRef = useRef(false);

  const [focusedField, setFocusedField] = useState<'number' | 'amount'>('number');

  const handleKeyPress = (key: string) => {
    if (focusedField === 'number') {
      if (key === '.') return; // No decimals in lottery numbers
      const maxLen = betType === 'CH' ? 2 : 4;
      if (number.length < maxLen) {
        const newNumber = number + key;
        setNumber(newNumber);
        if (newNumber.length === maxLen) {
          setFocusedField('amount');
          setIsAmountSelected(true);
          setTimeout(() => {
            amountInputRef.current?.focus();
            amountInputRef.current?.select();
          }, 0);
        }
      }
    } else {
      // For amount/quantity
      if (key === '.') {
        const currentVal = betType === 'CH' ? quantity : plAmount;
        if (currentVal.includes('.') || currentVal === '') return;
      }
      
      if (betType === 'CH') {
        if (isAmountSelected) {
          setQuantity(key === '.' ? '0.' : key);
          setIsAmountSelected(false);
        } else {
          setQuantity(quantity + key);
        }
      } else {
        if (isAmountSelected) {
          setPlAmount(key === '.' ? '0.' : key);
          setIsAmountSelected(false);
        } else if (plAmount === '1.00' && key !== '.') {
          setPlAmount(key);
        } else {
          setPlAmount(plAmount + key);
        }
      }
    }
  };

  const handleBackspace = () => {
    if (focusedField === 'number') {
      setNumber(number.slice(0, -1));
    } else {
      if (isAmountSelected) {
        if (betType === 'CH') setQuantity('');
        else setPlAmount('');
        setIsAmountSelected(false);
        return;
      }
      if (betType === 'CH') {
        const newVal = quantity.slice(0, -1);
        setQuantity(newVal || '');
      } else {
        const newVal = plAmount.slice(0, -1);
        setPlAmount(newVal || '1.00');
      }
    }
  };

  const handleClear = () => {
    setNumber('');
    if (betType === 'CH') setQuantity('1');
    else setPlAmount('1.00');
    setFocusedField('number');
  };

  // Vista de escritorio: portátil o tableta en horizontal. No afecta móvil ni vertical.
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => window.matchMedia('(min-width: 1024px) and (orientation: landscape)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px) and (orientation: landscape)');
    const update = () => setIsDesktopLayout(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // Teclado físico en Ventas (solo escritorio): dígitos, punto, Retroceso/Supr y Enter para agregar.
  const physicalKeyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  physicalKeyHandlerRef.current = (event: KeyboardEvent) => {
    if (!isDesktopLayout || activeTab !== 'sales') return;
    if (showCheckoutModal || showFastEntryModal || showTicketModal || numberTicketsModal || showTicketScanner || showUserModal || showMultiSelect || confirmModal) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleKeyPress(event.key);
    } else if (event.key === '.' || event.key === ',') {
      event.preventDefault();
      handleKeyPress('.');
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      handleBackspace();
    } else if (event.key === 'Enter' && number) {
      event.preventDefault();
      addToCart();
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => physicalKeyHandlerRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const NumericKeyboard = ({ onKeyPress, onBackspace, onClear }: { 
    onKeyPress: (key: string) => void; 
    onBackspace: () => void;
    onClear: () => void;
  }) => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];
    
    return (
      <div className="grid grid-cols-3 gap-1.5 w-full max-w-md mx-auto">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onKeyPress(key)}
            className="h-14 md:h-16 bg-white/5 border border-border rounded-xl text-xl font-bold hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          onClick={onBackspace}
          className="h-14 md:h-16 bg-white/5 border border-border rounded-xl text-xl font-bold hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
        >
          <Delete className="w-6 h-6" />
        </button>
        <div className="col-span-3 flex justify-center mt-1">
          <button
            type="button"
            onClick={onClear}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };
  const handleNumberChange = (val: string) => {
    const cleanVal = val.replace(/\D/g, '');
    setNumber(cleanVal);
    
    // Auto-focus logic
    const maxLength = betType === 'CH' ? 2 : 4;
    if (cleanVal.length === maxLength) {
      amountInputRef.current?.focus();
      amountInputRef.current?.select();
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setLoading(true);
      if (u) {
        try {
          // Force token refresh so latest custom claims (role) are available to Firestore rules.
          await u.getIdToken(true);
          const token = await u.getIdTokenResult();
          if (!token.claims?.role) {
            console.warn('Authenticated user without role claim. Firestore writes/reads by role may fail until claims are synced.');
          }
        } catch (tokenError) {
          console.error('Error refreshing auth token/claims:', tokenError);
        }

        const storedSessionDay = getStoredSessionDay();
        const currentSessionDay = getCurrentOperationalSessionDay();

        if (!storedSessionDay) {
          markSessionDay();
        } else if (storedSessionDay !== currentSessionDay) {
          if (enforceSessionByOperationalDay) {
            console.log('Session expired by operational day change. Signing out.');
            handleLogout();
            setUser(null);
            setUserProfile(null);
            setLoading(false);
            toast.info('Debe iniciar sesión nuevamente por cambio de día operativo.');
            return;
          }
          markSessionDay();
        }
      }

      setUser(u);
      if (u && u.email) {
        const email = u.email.toLowerCase();
        const ceoEmail = import.meta.env.VITE_CEO_EMAIL || 'zsayeth09@gmail.com';
        
        if (email === ceoEmail.toLowerCase()) {
          console.log("CEO logged in:", email, u.uid);
          try {
            const userDoc = await getDoc(doc(db, 'users', email));
            if (userDoc.exists()) {
              const data = userDoc.data() as UserProfile;
              data.role = 'ceo'; // Ensure role is ceo
              if (!data.name) data.name = 'CEO';
              if (!data.email) data.email = email;
              setUserProfile(data);
            } else {
              const defaultCeoProfile: UserProfile = {
                email: email,
                name: 'CEO',
                role: 'ceo',
                commissionRate: 0,
                status: 'active',
                sellerId: 'CEO01'
              };
              await setDoc(doc(db, 'users', email), defaultCeoProfile);
              setUserProfile(defaultCeoProfile);
            }
          } catch (error) {
            console.error('Error fetching CEO profile:', error);
            setUserProfile({
              email: email,
              name: 'CEO',
              role: 'ceo',
              commissionRate: 0,
              status: 'active',
              sellerId: 'CEO01'
            });
          }
        } else {
          try {
            console.log("Non-CEO user logged in:", email, u.uid);
            const userDoc = await getDoc(doc(db, 'users', email));
            if (userDoc.exists()) {
              setUserProfile(userDoc.data() as UserProfile);
            } else {
              console.warn("User profile not found in Firestore for:", email);
              setUserProfile(null);
            }
          } catch (error) {
            console.error('Error fetching user profile:', error);
            setUserProfile(null);
          }
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.email) return;

    const email = user.email.toLowerCase();
    const lastCheckStorageKey = `${USER_STATUS_LAST_CHECK_STORAGE_PREFIX}${email}`;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval>;

    const signOutInactiveUser = async (message = 'Usuario inactivo. Contactar al administrador.') => {
      if (stopped) return;
      setUserProfile(null);
      setUser(null);
      clearSessionDay();
      await signOut(auth);
      toast.error(message);
    };

    const checkCurrentUserStatus = async (force = false) => {
      const currentUser = auth.currentUser;
      const currentEmail = currentUser?.email?.toLowerCase();
      if (!currentEmail || currentEmail !== email) return;

      const now = Date.now();
      const lastCheck = Number(localStorage.getItem(lastCheckStorageKey) || 0);
      if (!force && lastCheck && now - lastCheck < USER_STATUS_CHECK_INTERVAL_MS) return;

      try {
        const userDoc = await getDocFromServer(doc(db, 'users', email));
        localStorage.setItem(lastCheckStorageKey, String(now));

        if (!userDoc.exists()) {
          await signOutInactiveUser('Tu usuario no existe en la base de datos.');
          return;
        }

        const profile = userDoc.data() as UserProfile;
        if ((profile.status || 'active') !== 'active') {
          await signOutInactiveUser();
          return;
        }

        setUserProfile(profile);
      } catch (error) {
        console.error('Error checking current user status:', error);
      }
    };

    const checkWhenDue = () => {
      if (document.visibilityState === 'hidden') return;
      void checkCurrentUserStatus(false);
    };

    void checkCurrentUserStatus(false);
    intervalId = setInterval(() => {
      void checkCurrentUserStatus(true);
    }, USER_STATUS_CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkWhenDue);
    document.addEventListener('visibilitychange', checkWhenDue);

    return () => {
      stopped = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', checkWhenDue);
      document.removeEventListener('visibilitychange', checkWhenDue);
    };
  }, [user?.email]);

  // Check session validity periodically to enforce one login per operational day.
  useEffect(() => {
    if (!user || !enforceSessionByOperationalDay) return;
    
    const interval = setInterval(() => {
      if (!isSessionValid()) {
        console.log('Session expired by operational day change. Signing out.');
        handleLogout();
        toast.info('Su sesión expiró por cambio de día operativo. Inicie sesión nuevamente.');
      }
    }, 60000); // Check every minute
    
    return () => clearInterval(interval);
  }, [enforceSessionByOperationalDay, user]);

  const getBusinessDayRange = useCallback((day: string) => {
    const start = new Date(`${day}T03:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, []);

  const getTicketDateKey = useCallback((ticket: LotteryTicket) => {
    if (ticket.date) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(ticket.date)) return ticket.date;
      const parsed = new Date(ticket.date);
      if (!isNaN(parsed.getTime())) {
        return format(parsed, 'yyyy-MM-dd');
      }
    }
    if (ticket.timestamp?.toDate) return format(getBusinessDate(ticket.timestamp.toDate()), 'yyyy-MM-dd');
    if (ticket.timestamp?.seconds) return format(getBusinessDate(new Date(ticket.timestamp.seconds * 1000)), 'yyyy-MM-dd');
    const parsed = new Date(ticket.timestamp ?? Date.now());
    return isNaN(parsed.getTime()) ? businessDayKey : format(getBusinessDate(parsed), 'yyyy-MM-dd');
  }, [businessDayKey]);

  const mergeTicketSnapshots = useCallback((...snapshots: Array<{ docs: Array<{ id: string; data: () => unknown }> } | null>) => {
    const merged = new Map<string, LotteryTicket>();
    snapshots.forEach(snapshot => {
      snapshot?.docs.forEach(ticketDoc => {
        merged.set(ticketDoc.id, { id: ticketDoc.id, ...(ticketDoc.data() as Omit<LotteryTicket, 'id'>) });
      });
    });
    return Array.from(merged.values()).sort((a, b) => {
      const aTime = a.timestamp?.toDate?.()?.getTime?.() ?? 0;
      const bTime = b.timestamp?.toDate?.()?.getTime?.() ?? 0;
      return bTime - aTime;
    });
  }, []);

  const getResultKey = useCallback((result: LotteryResult) => {
    return result.id || `${result.lotteryId}|${result.date}|${result.firstPrize}|${result.secondPrize}|${result.thirdPrize}`;
  }, []);

  const sortResultsByRecency = useCallback((items: LotteryResult[]) => {
    return [...items].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      const aTime = a.timestamp?.toDate?.()?.getTime?.() ?? (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
      const bTime = b.timestamp?.toDate?.()?.getTime?.() ?? (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
      return bTime - aTime;
    });
  }, []);

  const mergeResultsWithLiveFeed = useCallback((previous: LotteryResult[], liveResults: LotteryResult[]) => {
    const liveKeys = new Set(liveResults.map(getResultKey));
    const merged = new Map<string, LotteryResult>();

    liveResults.forEach(item => {
      merged.set(getResultKey(item), item);
    });

    previous.forEach(item => {
      const key = getResultKey(item);
      if (!liveKeys.has(key) && item.date !== businessDayKey) {
        merged.set(key, item);
      }
    });

    return sortResultsByRecency(Array.from(merged.values()));
  }, [businessDayKey, getResultKey, sortResultsByRecency]);

  const getQuickOperationalDate = useCallback((offset: number) => {
    const d = getBusinessDate();
    d.setDate(d.getDate() + offset);
    return format(d, 'yyyy-MM-dd');
  }, []);

  const applyOperationalQuickDate = useCallback((setter: (value: string) => void, offset: number) => {
    setter(getQuickOperationalDate(offset));
  }, [getQuickOperationalDate]);

  const runOperationalArchiveAndCleanup = useCallback(async ({
    targetBusinessDay,
    trigger
  }: {
    targetBusinessDay: string;
    trigger: 'manual' | 'automatic';
  }) => {
    const { start, end } = getBusinessDayRange(targetBusinessDay);
    const archiveRef = doc(db, 'daily_archives', targetBusinessDay);

    const [ticketsSnapshot, resultsSnapshot, settlementsSnapshot, archiveSnapshot] = await Promise.all([
      getDocs(query(
        collection(db, 'tickets'),
        where('timestamp', '>=', start),
        where('timestamp', '<', end)
      )),
      getDocs(query(
        collection(db, 'results'),
        where('date', '==', targetBusinessDay)
      )),
      getDocs(query(
        collection(db, 'settlements'),
        where('date', '==', targetBusinessDay)
      )),
      getDoc(archiveRef)
    ]);

    const ticketsToArchive = ticketsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const resultsToArchive = resultsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const settlementsToArchive = settlementsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const archiveAlreadyExists = archiveSnapshot.exists();

    if (!archiveAlreadyExists) {
      await setDoc(archiveRef, {
        date: targetBusinessDay,
        tickets: ticketsToArchive,
        results: resultsToArchive,
        settlements: settlementsToArchive,
        createdAt: serverTimestamp(),
        archivedBy: (userProfile?.email || user?.email || '').toLowerCase(),
        archiveTrigger: trigger
      });
    }

    const docsToDelete = [
      ...ticketsSnapshot.docs,
      ...resultsSnapshot.docs
    ];

    for (let i = 0; i < docsToDelete.length; i += 450) {
      const batch = writeBatch(db);
      const chunk = docsToDelete.slice(i, i + 450);
      chunk.forEach(docSnap => batch.delete(docSnap.ref));
      await batch.commit();
    }

    if (targetBusinessDay === businessDayKey) {
      setTickets([]);
      setResults([]);
      setHistoryTickets([]);
      setHistoryResults([]);
      setLiquidationTicketsSnapshot([]);
      setLiquidationResultsSnapshot([]);
      setLiquidationSettlementsSnapshot([]);
    }

    return {
      targetBusinessDay,
      archiveAlreadyExists,
      deletedCount: docsToDelete.length
    };
  }, [businessDayKey, getBusinessDayRange, user?.email, userProfile?.email]);

  useEffect(() => {
    if (!user?.uid || !userProfile?.role) return;
    if (!['ceo', 'admin', 'programador'].includes(userProfile.role)) return;
    if (autoCleanupRunningRef.current) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const autoCleanupExecutionMinutes = 4 * 60 + 30;
    if (currentMinutes < autoCleanupExecutionMinutes) return;

    const todayKey = format(now, 'yyyy-MM-dd');
    const autoCleanupStorageKey = 'autoCleanupLastRunDate';
    if (localStorage.getItem(autoCleanupStorageKey) === todayKey) return;

    autoCleanupRunningRef.current = true;

    (async () => {
      try {
        const targetBusinessDay = getQuickOperationalDate(-1);
        await runOperationalArchiveAndCleanup({
          targetBusinessDay,
          trigger: 'automatic'
        });
        localStorage.setItem(autoCleanupStorageKey, todayKey);
      } catch (error) {
        console.error('Error en limpieza automatica:', error);
      } finally {
        autoCleanupRunningRef.current = false;
      }
    })();
  }, [getQuickOperationalDate, runOperationalArchiveAndCleanup, user?.uid, userProfile?.role, tick]);

  // Con la app oculta más de 3 minutos se cierran las escuchas en tiempo real (cada ticket nuevo cuesta una lectura por escucha abierta).
  const [isPageActive, setIsPageActive] = useState(true);
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hideTimer = setTimeout(() => setIsPageActive(false), 3 * 60 * 1000);
      } else {
        if (hideTimer) clearTimeout(hideTimer);
        setIsPageActive(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const needsRealtimeOperationalData = useMemo(() => {
    if (!userProfile?.role || !isPageActive) return false;
    if (activeTab === 'sales' || activeTab === 'dashboard' || activeTab === 'liquidaciones') return true;
    if ((activeTab === 'history' || activeTab === 'stats' || activeTab === 'cierres') && historyDate === businessDayKey) return true;
    if (activeTab === 'archivo' && archiveDate === businessDayKey) return true;
    return false;
  }, [activeTab, archiveDate, businessDayKey, historyDate, isPageActive, userProfile?.role]);

  // 1. Static/Global Data
  useEffect(() => {
    if (!user?.uid || !userProfile?.role) return;

    // Fetch lotteries
    const qLot = query(collection(db, 'lotteries'), orderBy('name'));
    const unsubscribeLotteries = onSnapshot(qLot, async (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lottery));
      setLotteries(docs);
      historyDataCacheRef.current.clear();liquidationDayCacheRef.current.clear();
      
      // Use sorted lotteries to pick the first active one by time
      if (docs.length > 0 && !selectedLottery) {
        const getSortValue = (time: string) => {
          const [h, m] = time.split(':').map(Number);
          let val = h * 60 + m;
          if (val < 11 * 60) val += 24 * 60;
          return val;
        };
        const sorted = [...docs].sort((a, b) => getSortValue(a.drawTime || '00:00') - getSortValue(b.drawTime || '00:00'));
        const firstActive = sorted.find(l => l.active);
        if (firstActive) setSelectedLottery(firstActive.name);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'lotteries');
    });

    // Fetch global settings
    console.log("Fetching global settings for role:", userProfile.role);
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'global'), async (snapshot) => {
      if (snapshot.exists()) {
        console.log("Global settings fetched successfully");
        const data = snapshot.id ? { id: snapshot.id, ...snapshot.data() } as GlobalSettings : snapshot.data() as GlobalSettings;
        setGlobalSettings(data);
        historyDataCacheRef.current.clear();liquidationDayCacheRef.current.clear();
      } else {
        console.warn("Global settings document not found");
        // If CEO is logged in and settings are missing, initialize them
        if (userProfile.role === 'ceo') {
          console.log("Initializing global settings for the first time...");
          const initialSettings: GlobalSettings = {
            id: 'global',
            chancePrices: [
              { price: 5, ch1: 300, ch2: 50, ch3: 10 },
              { price: 10, ch1: 600, ch2: 100, ch3: 20 },
              { price: 20, ch1: 1200, ch2: 200, ch3: 40 }
            ],
            palesEnabled: true,
            billetesEnabled: true,
            pl12Multiplier: 1000,
            pl13Multiplier: 1000,
            pl23Multiplier: 200,
            nextSellerNumber: 1
          };
          try {
            await setDoc(doc(db, 'settings', 'global'), initialSettings);
            console.log("Global settings initialized successfully");
            // Also initialize connectivity doc for testing
            await setDoc(doc(db, 'public', 'connectivity'), { lastTested: serverTimestamp() });
          } catch (err) {
            console.error("Error initializing global settings:", err);
          }
        }
      }
    }, (error) => {
      console.error("Error fetching global settings:", error);
      handleFirestoreError(error, OperationType.GET, 'settings/global');
    });

    return () => {
      unsubscribeLotteries();
      unsubscribeSettings();
    };
  }, [user?.uid, userProfile?.role]);

  useEffect(() => {
      if (!user?.uid || !canViewPaleSimulation) {
        setPaleSimulationSettings({ enabled: false, multiplier: null });
        setPaleSimulationMultiplierInput('');
        return;
      }

      return onSnapshot(doc(db, 'settings', 'paleSimulation'), (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        const multiplier = typeof data.multiplier === 'number' && Number.isFinite(data.multiplier) && data.multiplier > 0
          ? data.multiplier
          : null;
        const nextSettings = { enabled: data.enabled === true, multiplier };
        setPaleSimulationSettings(nextSettings);
        setPaleSimulationMultiplierInput(multiplier === null ? '' : String(multiplier));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/paleSimulation');
      });
  }, [canViewPaleSimulation, user?.uid]);

  // 2. Stable Real-time Results Feed (operational day)
  useEffect(() => {
    if (!user?.uid || !userProfile?.role) return;

    const qRes = query(
      collection(db, 'results'),
      where('date', '==', businessDayKey),
      limit(300)
    );
    const unsubscribeResults = onSnapshot(qRes, (snapshot) => {
      const docs = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as LotteryResult));
      setResults(prev => mergeResultsWithLiveFeed(prev, docs));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'results');
    });

    return () => unsubscribeResults();
  }, [businessDayKey, mergeResultsWithLiveFeed, user?.uid, userProfile?.role]);

  // 3. Today's ticket feed stays shared across dashboard/report views for global-read roles.
  useEffect(() => {
    if (!user?.uid || !userProfile?.role) return;
    if (!needsRealtimeOperationalData) return;

    console.log("Fetching today's tickets for user:", user.uid);

    if (ticketFeedIsGlobal) {
      const { start: dayStart, end: dayEnd } = getBusinessDayRange(businessDayKey);
      const qTodayByTime = query(
        collection(db, 'tickets'),
        where('timestamp', '>=', dayStart),
        where('timestamp', '<', dayEnd),
        limit(2000)
      );
      const unsubscribeTickets = onSnapshot(qTodayByTime, (snapshot) => {
        setTickets(mergeTicketSnapshots(null, snapshot));
      }, (error) => {
        console.error("Error fetching today's tickets:", error);
        handleFirestoreError(error, OperationType.GET, 'tickets_today');
      });
      return unsubscribeTickets;
    }

    const sellerEmail = user.email?.toLowerCase();
    // Por timestamp del servidor (como el admin y el historial): no depende del campo `date` escrito por el dispositivo.
    const { start: sellerDayStart, end: sellerDayEnd } = getBusinessDayRange(businessDayKey);
    const qTodayBySeller = query(
      collection(db, 'tickets'),
      where('sellerId', '==', user.uid),
      where('timestamp', '>=', sellerDayStart),
      where('timestamp', '<', sellerDayEnd),
      limit(2000)
    );

    const unsubscribeTicketsBySeller = onSnapshot(qTodayBySeller, (snapshot) => {
      const docs = snapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...(docSnap.data() as Omit<LotteryTicket, 'id'>) }))
        .filter(ticket => ticket.sellerId === user.uid || ticket.sellerEmail?.toLowerCase() === sellerEmail);
      console.log("Today's seller tickets fetched successfully:", docs.length);
      setTickets(docs);
    }, (error) => {
      console.error("Error fetching today's tickets by seller:", error);
      handleFirestoreError(error, OperationType.GET, 'tickets_today_by_seller');
    });

    return unsubscribeTicketsBySeller;
  }, [businessDayKey, getBusinessDayRange, mergeTicketSnapshots, needsRealtimeOperationalData, ticketFeedIsGlobal, user?.uid, user?.email, userProfile?.role]);

  // Settlements remain scoped to the current view; ticket navigation does not reopen their listener.
  useEffect(() => {
    if (!user?.uid || !userProfile?.role || !needsRealtimeOperationalData) return;

    console.log("Fetching settlements for user:", user?.email?.toLowerCase());
    const qSettlements = canAccessAllUsers
      ? query(
          collection(db, 'settlements'),
          where('date', '==', businessDayKey),
          limit(50)
        )
      : query(
          collection(db, 'settlements'),
          where('userEmail', '==', user.email?.toLowerCase()),
          where('date', '==', businessDayKey),
          limit(20)
        );
    const unsubscribeSettlements = onSnapshot(qSettlements, (snapshot) => {
      console.log("Settlements fetched successfully:", snapshot.size);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Settlement));
      setSettlements(docs);
    }, (error) => {
      console.error("Error fetching settlements:", error);
      handleFirestoreError(error, OperationType.GET, 'settlements');
    });

    return unsubscribeSettlements;
  }, [businessDayKey, canAccessAllUsers, needsRealtimeOperationalData, user?.uid, user?.email, userProfile?.role]);

  // 4. History Data (Conditional on Date)
  useEffect(() => {
    if (!user?.uid || !userProfile?.role || (activeTab !== 'history' && activeTab !== 'stats' && activeTab !== 'cierres')) return;
    let cancelled = false;

    const loadHistoricalData = async () => {
      const { start, end } = getBusinessDayRange(historyDate);
      const sellerEmail = user.email?.toLowerCase();
      const scopeKey = canAccessAllUsers ? 'global' : `seller:${sellerEmail || user.uid}`;
      const cacheKey = `${historyDate}|${scopeKey}`;
      const cachedData = historyDataCacheRef.current.get(cacheKey);

      if (cachedData && historyDate !== businessDayKey) {
        if (!cancelled) {
          setHistoryTickets(cachedData.tickets);
          setHistorySettlements(cachedData.settlements);
          setHistoryResults(cachedData.results);
          setResults(prev => {
            const map = new Map(prev.map(item => [`${item.lotteryName}-${item.date}-${item.id}`, item]));
            cachedData.results.forEach(item => map.set(`${item.lotteryName}-${item.date}-${item.id}`, item));
            return Array.from(map.values());
          });
        }
        return;
      }

      try {
        if (historyDate === businessDayKey) {
          if (!cancelled) {
            const currentUserEmail = user.email?.toLowerCase();
            const visibleTickets = canAccessAllUsers
              ? tickets
              : tickets.filter(ticket => (
                  ticket.sellerId === user.uid ||
                  ticket.sellerEmail?.toLowerCase() === currentUserEmail
                ));
            setHistoryTickets(visibleTickets);
            setHistorySettlements(settlements.filter(s => s.date === historyDate));
            setHistoryResults(results.filter(r => r.date === historyDate));
          }
          return;
        }

        if (canAccessAllUsers) {
          const [ticketSnap, settlementSnap, resultSnap] = await Promise.all([
            getDocs(query(
              collection(db, 'tickets'),
              where('timestamp', '>=', start),
              where('timestamp', '<', end),
              limit(2500)
            )),
            getDocs(query(
              collection(db, 'settlements'),
              where('date', '==', historyDate),
              limit(1000)
            )),
            getDocs(query(
              collection(db, 'results'),
              where('date', '==', historyDate),
              limit(300)
            ))
          ]);

          if (!cancelled) {
            const loadedTickets = mergeTicketSnapshots(ticketSnap);
            const loadedSettlements = settlementSnap.docs.map(d => ({ id: d.id, ...d.data() } as Settlement));
            const loadedResults = resultSnap.docs.map(d => ({ id: d.id, ...d.data() } as LotteryResult));
            setHistoryTickets(loadedTickets);
            setHistorySettlements(loadedSettlements);
            setHistoryResults(loadedResults);
            historyDataCacheRef.current.set(cacheKey, {
              tickets: loadedTickets,
              settlements: loadedSettlements,
              results: loadedResults
            });
            setResults(prev => {
              const map = new Map(prev.map(item => [`${item.lotteryName}-${item.date}-${item.id}`, item]));
              loadedResults.forEach(item => map.set(`${item.lotteryName}-${item.date}-${item.id}`, item));
              return Array.from(map.values());
            });
          }
          return;
        }

        const historyBySellerIdQ = query(
          collection(db, 'tickets'),
          where('sellerId', '==', user.uid),
          where('timestamp', '>=', start),
          where('timestamp', '<', end),
          limit(600)
        );
        const historyBySellerEmailQ = sellerEmail
          ? query(
              collection(db, 'tickets'),
              where('sellerEmail', '==', sellerEmail),
              where('timestamp', '>=', start),
              where('timestamp', '<', end),
              limit(600)
            )
          : null;

        const [historyByIdSnap, historyByEmailSnap, settlementSnap, resultSnap] = await Promise.all([
          getDocs(historyBySellerIdQ),
          historyBySellerEmailQ ? getDocs(historyBySellerEmailQ) : Promise.resolve(null),
          sellerEmail ? getDocs(query(
            collection(db, 'settlements'),
            where('userEmail', '==', sellerEmail),
            where('date', '==', historyDate),
            limit(300)
          )) : Promise.resolve(null),
          getDocs(query(
            collection(db, 'results'),
            where('date', '==', historyDate),
            limit(300)
          ))
        ]);

        if (!cancelled) {
          const loadedTickets = mergeTicketSnapshots(historyByIdSnap, historyByEmailSnap);
          const loadedSettlements = settlementSnap ? settlementSnap.docs.map(d => ({ id: d.id, ...d.data() } as Settlement)) : [];
          const loadedResults = resultSnap.docs.map(d => ({ id: d.id, ...d.data() } as LotteryResult));
          setHistoryTickets(loadedTickets);
          setHistorySettlements(loadedSettlements);
          setHistoryResults(loadedResults);
          historyDataCacheRef.current.set(cacheKey, {
            tickets: loadedTickets,
            settlements: loadedSettlements,
            results: loadedResults
          });
          setResults(prev => {
            const map = new Map(prev.map(item => [`${item.lotteryName}-${item.date}-${item.id}`, item]));
            loadedResults.forEach(item => map.set(`${item.lotteryName}-${item.date}-${item.id}`, item));
            return Array.from(map.values());
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'historical_data');
      }
    };

    void loadHistoricalData();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    businessDayKey,
    canAccessAllUsers,
    getBusinessDayRange,
    historyDate,
    mergeTicketSnapshots,
    settlements,
    tickets,
    user?.uid,
    user?.email,
    userProfile?.role
  ]);

  useEffect(() => {
    if (!globalSettings.chancePrices || globalSettings.chancePrices.length === 0) return;

    const availablePrices = globalSettings.chancePrices.map(cp => cp.price);
    const hasPrice = (value: number | undefined) => value !== undefined && availablePrices.some(price => Math.abs(price - value) < 0.001);
    const preferredPrice = userProfile?.preferredChancePrice;
    const fallbackPrice = availablePrices[0];
    const nextPrice = hasPrice(preferredPrice) ? preferredPrice! : fallbackPrice;

    setChancePrice(currentPrice => (
      Math.abs(currentPrice - nextPrice) >= 0.001 ? nextPrice : currentPrice
    ));
  }, [globalSettings.chancePrices, userProfile?.preferredChancePrice]);

  const getTicketChancePrice = (ticket: LotteryTicket): number | null => {
    if (typeof ticket.chancePrice === 'number' && !Number.isNaN(ticket.chancePrice)) {
      return ticket.chancePrice;
    }

    const chanceBet = (ticket.bets || []).find(b => b.type === 'CH' && (b.quantity || 0) > 0 && (b.amount || 0) > 0);
    if (!chanceBet) return null;

    const inferredPrice = chanceBet.amount / chanceBet.quantity;
    const matchedPrice = globalSettings.chancePrices?.find(cp => Math.abs(cp.price - inferredPrice) < 0.001);
    return matchedPrice ? matchedPrice.price : Number(inferredPrice.toFixed(2));
  };

  const ticketMatchesGlobalChancePrice = (ticket: LotteryTicket) => {
    if (!canAccessAllUsers || !globalChancePriceFilter) return true;
    const target = parseFloat(globalChancePriceFilter);
    const chanceBets = (ticket.bets || []).filter(b => b.type === 'CH' && (b.quantity || 0) > 0 && (b.amount || 0) > 0);
    if (chanceBets.length > 0) {
      return chanceBets.some(b => Math.abs(getBetUnitPrice(b) - target) < 0.001);
    }
    const ticketPrice = getTicketChancePrice(ticket);
    if (ticketPrice === null) return false;
    return Math.abs(ticketPrice - target) < 0.001;
  };

  // The selected price stays until the user changes it again.
  const selectChancePrice = (price: number) => {
    setChancePrice(price);
    if (!userProfile?.email) return;
    setUserProfile({ ...userProfile, preferredChancePrice: price });
    updateDoc(doc(db, 'users', userProfile.email.toLowerCase()), { preferredChancePrice: price })
      .catch(error => console.error('Error saving preferred chance price:', error));
  };

  const getComboRules = (type: 'PL' | 'BL') => {
    const limitValue = type === 'PL' ? globalSettings.palesLimit : globalSettings.billetesLimit;
    const fixed = (type === 'PL' ? globalSettings.palesFixedAmounts : globalSettings.billetesFixedAmounts) || [];
    return { limit: limitValue && limitValue > 0 ? limitValue : DEFAULT_COMBO_LIMIT, fixed };
  };

  const getComboSold = (type: 'PL' | 'BL', num: string, lot: string) =>
    tickets
      .filter(t => t.status === 'active' && t.bets && t.id !== editingTicketId)
      .flatMap(t => t.bets)
      .filter(b => b && b.type === type && b.number === num && cleanText(b.lottery) === cleanText(lot))
      .reduce((acc, b) => acc + (b.amount || 0), 0);

  // Costo fijo = monto mínimo y paso: solo se factura en múltiplos de ese valor (1, 2, 3...) hasta el límite global.
  // Sin costo fijo se acepta cualquier monto desde 0.10. Superar el límite lo valida exceedsComboLimit.
  const validateComboUnitCost = (type: 'PL' | 'BL', totalAmount: number, unitCost: number = totalAmount) => {
    const { fixed } = getComboRules(type);
    const step = fixed.length > 0 ? Math.min(...fixed) : 0;
    const label = type === 'PL' ? 'Palé' : 'Billete';
    if (Number.isNaN(unitCost) || Number.isNaN(totalAmount) || unitCost < 0.10) {
      toast.error(`El mínimo para ${label} es USD 0.10`);
      return false;
    }
    if (step > 0) {
      const multiple = Math.round(totalAmount / step);
      if (totalAmount < step - 0.005 || Math.abs(multiple * step - totalAmount) > 0.005) {
        toast.error(`${label}: el costo fijo es $${step.toFixed(2)}. Solo se factura de ${step.toFixed(2)} en ${step.toFixed(2)} ($${step.toFixed(2)}, $${(step * 2).toFixed(2)}, $${(step * 3).toFixed(2)}...). Corrija el monto o quite la jugada.`);
        return false;
      }
    }
    return true;
  };
  // Bloquea si lo vendido + lo que está en el carrito + lo nuevo supera el límite de la combinación exacta
  const exceedsComboLimit = (type: 'PL' | 'BL', num: string, lot: string, addAmount: number, cartItems: Bet[]) => {
    const { limit: comboLimit } = getComboRules(type);
    const inCart = cartItems
      .filter(b => b && b.type === type && b.number === num && cleanText(b.lottery) === cleanText(lot))
      .reduce((acc, b) => acc + (b.amount || 0), 0);
    const sold = getComboSold(type, num, lot);
    if (sold + inCart + addAmount > comboLimit + 0.0001) {
      const available = Math.max(0, comboLimit - sold - inCart);
      toast.error(`Límite alcanzado: ${type === 'PL' ? 'Palé' : 'Billete'} ${num} en ${cleanText(lot)} admite máximo USD ${comboLimit.toFixed(2)} (disponible USD ${available.toFixed(2)}). Corrija el monto o quite la jugada.`);
      return true;
    }
    return false;
  };

  // Contador global: 1 documento por día + sorteo + tipo con un mapa número -> monto.
  // Una venta lee/escribe como máximo 1 documento por sorteo y tipo (no uno por combinación).
  const groupCombos = (bets: Bet[], dayKey: string) => {
    const groups = new Map<string, { type: 'PL' | 'BL'; lottery: string; numbers: Map<string, number> }>();
    (bets || []).forEach(b => {
      if (!b || (b.type !== 'PL' && b.type !== 'BL')) return;
      const lottery = cleanText(b.lottery);
      const id = encodeURIComponent(`${dayKey}|${b.type}|${lottery}`);
      const group = groups.get(id) || { type: b.type, lottery, numbers: new Map<string, number>() };
      group.numbers.set(b.number, (group.numbers.get(b.number) || 0) + (b.amount || 0));
      groups.set(id, group);
    });
    return groups;
  };

  // Se valida y actualiza en la misma transacción que guarda/borra el ticket.
  const commitWithComboCounters = async (
    newBets: Bet[],
    oldBets: Bet[],
    write: (transaction: Transaction) => void
  ) => {
    const dayKey = format(getBusinessDate(), 'yyyy-MM-dd');
    const next = groupCombos(newBets, dayKey);
    const prev = groupCombos(oldBets, dayKey);
    const ids = Array.from(new Set([...next.keys(), ...prev.keys()]));
    if (ids.length === 0) {
      await runTransaction(db, async (transaction) => { write(transaction); });
      return;
    }
    await runTransaction(db, async (transaction) => {
      const snaps = await Promise.all(ids.map(id => transaction.get(doc(db, 'comboCounters', id))));
      const writes: { id: string; type: 'PL' | 'BL'; lottery: string; amounts: Record<string, number> }[] = [];
      ids.forEach((id, i) => {
        const nextGroup = next.get(id);
        const prevGroup = prev.get(id);
        const type = (nextGroup || prevGroup)!.type;
        const lottery = (nextGroup || prevGroup)!.lottery;
        const stored: Record<string, number> | null = snaps[i].exists() ? (snaps[i].data()?.amounts || {}) : null;
        const { limit: comboLimit } = getComboRules(type);
        const numbers = new Set([...(nextGroup?.numbers.keys() || []), ...(prevGroup?.numbers.keys() || [])]);
        const changed: Record<string, number> = {};
        numbers.forEach(num => {
          const newAmount = nextGroup?.numbers.get(num) || 0;
          const oldAmount = prevGroup?.numbers.get(num) || 0;
          if (newAmount === oldAmount) return;
          const base = stored
            ? Math.max(0, (Number(stored[num]) || 0) - oldAmount)
            : getComboSold(type, num, lottery);
          const total = base + newAmount;
          if (newAmount > oldAmount && total > comboLimit + 0.0001) {
            const available = Math.max(0, comboLimit - base);
            throw new Error(`COMBO_LIMIT:Límite alcanzado: ${type === 'PL' ? 'Palé' : 'Billete'} ${num} en ${lottery} admite máximo USD ${comboLimit.toFixed(2)} (disponible USD ${available.toFixed(2)}). Corrija el monto o quite la jugada.`);
          }
          changed[num] = Number(total.toFixed(2));
        });
        if (Object.keys(changed).length > 0) writes.push({ id, type, lottery, amounts: changed });
      });
      writes.forEach(({ id, type, lottery, amounts }) => {
        transaction.set(doc(db, 'comboCounters', id), {
          businessDate: dayKey,
          type,
          lottery,
          amounts,
          updatedAt: Date.now()
        }, { merge: true });
      });
      write(transaction);
    });
  };
  const addToCart = () => {
    if (!number || !quantity) {
      toast.error('Ingrese número y cantidad');
      return;
    }

    const qInt = parseInt(quantity);
    if (isNaN(qInt) || qInt <= 0) {
      toast.error('Cantidad inválida');
      return;
    }

    // Validate number length
    if (betType === 'CH' && number.length !== 2) {
      toast.error('Chance (CH) debe ser de 2 cifras');
      return;
    }
    if (betType === 'PL' && number.length !== 4) {
      toast.error('Pale (PL) debe ser de 4 cifras');
      return;
    }
    if (betType === 'BL' && number.length !== 4) {
      toast.error('Billete (BL) debe ser de 4 cifras');
      return;
    }

    if (betType === 'PL' && !globalSettings.palesEnabled) {
      toast.error('Pales están desactivados');
      return;
    }
    if (betType === 'BL' && !globalSettings.billetesEnabled) {
      toast.error('Billetes están desactivados');
      return;
    }

    const lotteriesToBuy = new Set<string>();
    if (isMultipleMode) {
      multiLottery.forEach(l => {
        const lottery = findActiveLotteryByName(l);
        if (betType === 'PL' && !lotteryAllowsPale(lottery)) {
          toast.error(`Sorteo ${l} no admite Palé`);
          return;
        }
        if (betType === 'BL' && !lotteryAllowsBillete(lottery)) {
          toast.error(`Sorteo ${l} no admite Billetes`);
          return;
        }
        if (betType === 'BL' && lottery && !isBilleteOpenForSales(lottery)) {
          toast.error(`Billetes de ${l} ya cerraron`);
          return;
        }
        lotteriesToBuy.add((lottery?.name || l).trim());
      });
    } else if (selectedLottery) {
      const lottery = findActiveLotteryByName(selectedLottery);
      if (betType === 'PL' && !lotteryAllowsPale(lottery)) {
        toast.error('Este sorteo no admite Palé');
        return;
      }
      if (betType === 'BL' && !lotteryAllowsBillete(lottery)) {
        toast.error('Este sorteo no admite Billetes');
        return;
      }
      if (betType === 'BL' && lottery && !isBilleteOpenForSales(lottery)) {
        toast.error('Los billetes de este sorteo ya cerraron');
        return;
      }
      lotteriesToBuy.add((lottery?.name || selectedLottery).trim());
    }
    
    if (lotteriesToBuy.size === 0) {
      toast.error('Seleccione al menos un sorteo válido');
      return;
    }

    let calculatedAmount = 0;
    if (betType === 'CH') {
      calculatedAmount = qInt * chancePrice;
    } else if (betType === 'BL') {
      calculatedAmount = parseFloat(plAmount); // Reusing plAmount for BL investment
      if (!validateComboUnitCost('BL', calculatedAmount)) return;
    } else {
      // For PL, quantity is units, plAmount is price per unit
      const costPerUnit = parseFloat(plAmount);
      calculatedAmount = qInt * costPerUnit;
      if (!validateComboUnitCost('PL', calculatedAmount, costPerUnit)) return;
    }

    for (const lot of lotteriesToBuy) {
      if ((betType === 'PL' || betType === 'BL') && exceedsComboLimit(betType, number, lot, calculatedAmount, cart)) {
        return;
      }
    }

    setCart(prevCart => {
      const newBets: Bet[] = [];
      lotteriesToBuy.forEach(lot => {
        newBets.push({
          number: number.trim(),
          lottery: lot.trim(),
          amount: calculatedAmount,
          type: betType,
          quantity: qInt,
          ...(betType === 'CH' ? { price: chancePrice } : {})
        });
      });
      return unifyBets([...prevCart, ...newBets]);
    });

    setNumber('');
    setQuantity('1');
    setPlAmount('1.00');
    setFocusedField('number');
    setTimeout(() => {
      numberInputRef.current?.focus();
    }, 0);
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const updateCartItemQuantity = (index: number, newQty: number) => {
    if (newQty < 1) return;
    const item = cart[index];
    if (!item) return;

    if (item.type === 'PL') {
      const unitAmount = item.amount / item.quantity;
      const others = cart.filter((_, i) => i !== index);
      if (exceedsComboLimit('PL', item.number, item.lottery, unitAmount * newQty, others)) return;
    }

    setCart(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const unitAmount = item.amount / item.quantity;
      return { ...item, quantity: newQty, amount: unitAmount * newQty };
    }));
  };

  const updateCartItemAmount = (index: number, newAmount: number) => {
    if (newAmount < 0) return;
    const target = cart[index];
    if (target && target.type === 'BL') {
      const others = cart.filter((_, i) => i !== index);
      if (!validateComboUnitCost('BL', newAmount)) return;
      if (exceedsComboLimit('BL', target.number, target.lottery, newAmount, others)) return;
    }
    setCart(prev => prev.map((item, i) => i === index ? { ...item, amount: newAmount } : item));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    setCart([]);
    toast.success('Panel limpiado');
  };

  const getDailySequence = () => {
    const now = serverNow();
    const startOfDay = new Date(now);
    // Reset at 1 AM
    if (now.getHours() < 1) {
      startOfDay.setDate(now.getDate() - 1);
    }
    startOfDay.setHours(1, 0, 0, 0);

    const dailyTickets = tickets.filter(t => {
      const tDate = t.timestamp?.toDate ? t.timestamp.toDate() : new Date();
      return tDate >= startOfDay;
    });

    const nextSeq = dailyTickets.length + 1;
    return nextSeq.toString().padStart(3, '0');
  };

  const handleSell = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || cart.length === 0 || isSubmittingSale || saleInFlightRef.current) return;
    setShowCheckoutModal(true);
  };

  const confirmSale = async () => {
    if (!user || cart.length === 0 || saleInFlightRef.current) return;

    const currentSellerEmail = user.email?.toLowerCase();
    if (!currentSellerEmail || (userProfile?.status || 'active') !== 'active') {
      setShowCheckoutModal(false);
      toast.error('Usuario inactivo. Contactar al administrador.');
      await signOut(auth);
      return;
    }

    saleInFlightRef.current = true;
    setIsSubmittingSale(true);

    const unifiedCart = unifyBets(cart);
    const totalAmount = unifiedCart.reduce((acc, item) => acc + item.amount, 0);
    const finalCustomerName = customerName.trim() || 'Cliente General';

    // Última barrera: ninguna combinación exacta puede superar el límite global
    for (const bet of unifiedCart) {
      if ((bet.type === 'PL' || bet.type === 'BL') &&
        exceedsComboLimit(bet.type, bet.number, bet.lottery, bet.amount, [])) {
        saleInFlightRef.current = false;
        setIsSubmittingSale(false);
        setShowCheckoutModal(false);
        return;
      }
    }

    const abortSale = (message: string) => {
      toast.error(message);
      saleInFlightRef.current = false;
      setIsSubmittingSale(false);
      setShowCheckoutModal(false);
    };

    // La hora de cierre se valida con el reloj del servidor, no con el del dispositivo
    if (!await syncServerClock()) {
      abortSale('No se pudo verificar la hora del servidor. Revise su conexión e intente de nuevo.');
      return;
    }

    // Verify if any lottery in the cart is closed or has results
    const todayStr = format(getBusinessDate(serverNow()), 'yyyy-MM-dd');
    for (const bet of unifiedCart) {
      const lot = lotteries.find(l => cleanText(l.name) === cleanText(bet.lottery));
      if (!lot) {
        abortSale(`Sorteo no encontrado: ${bet.lottery}`);
        return;
      }
      if (!isLotteryOpenForSales(lot)) {
        abortSale(`El sorteo ${bet.lottery} ya está cerrado.`);
        return;
      }
      if (bet.type === 'BL' && !isBilleteOpenForSales(lot)) {
        abortSale(`Los billetes de ${bet.lottery} ya cerraron.`);
        return;
      }
      const hasResult = results.some(r => cleanText(r.lotteryName) === cleanText(bet.lottery) && r.date === todayStr);
      if (hasResult) {
        abortSale(`El sorteo ${bet.lottery} ya tiene resultados.`);
        return;
      }
    }

    try {
      if (editingTicketId) {
        const originalTicket = tickets.find(t => t.id === editingTicketId) || historyTickets.find(t => t.id === editingTicketId);

        // Update existing ticket
        await commitWithComboCounters(unifiedCart, originalTicket?.bets || [], (transaction) => {
          transaction.update(doc(db, 'tickets', editingTicketId), {
            bets: unifiedCart,
            totalAmount,
            chancePrice,
            customerName: finalCustomerName,
            lastEditedAt: serverTimestamp()
          });
        });
        
        const updatedTicket: LotteryTicket = {
          ...originalTicket!,
          bets: unifiedCart,
          totalAmount,
          chancePrice,
          customerName: finalCustomerName,
        };

        setEditingTicketId(null);
        setCart([]);
        setMultiLottery([]);
        setCustomerName('');
        setShowCheckoutModal(false);
        setShowTicketModal({ ticket: updatedTicket });
        toast.success('¡Venta actualizada con éxito!');
      } else {
        // Create new ticket
        const sequenceNumber = getDailySequence();
        const ticketRef = doc(collection(db, 'tickets'));
        await commitWithComboCounters(unifiedCart, [], (transaction) => {
          transaction.set(ticketRef, {
            bets: unifiedCart,
            totalAmount,
            chancePrice,
            timestamp: serverTimestamp(),
            date: format(getBusinessDate(), 'yyyy-MM-dd'),
            sellerId: user.uid,
            sellerCode: userProfile?.sellerId || '---',
            sellerEmail: currentSellerEmail,
            sellerName: userProfile?.name || user.displayName || 'Vendedor',
            commissionRate: userProfile?.commissionRate || 0,
            status: 'active',
            customerName: finalCustomerName,
            sequenceNumber,
            liquidated: false
          });
        });
        const docRef = ticketRef;
        
        const newTicket: LotteryTicket = {
          id: docRef.id,
          bets: unifiedCart,
          totalAmount,
          chancePrice,
          timestamp: { toDate: () => new Date() },
          sellerId: user.uid,
          sellerCode: userProfile?.sellerId || '---',
          sellerEmail: currentSellerEmail,
          sellerName: userProfile?.name || user.displayName || 'Vendedor',
          commissionRate: userProfile?.commissionRate || 0,
          status: 'active',
          customerName: finalCustomerName,
          sequenceNumber
        };

        setCart([]);
        setMultiLottery([]);
        setCustomerName('');
        setShowCheckoutModal(false);
        setShowTicketModal({ ticket: newTicket });
        toast.success('¡Venta realizada con éxito!');
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('COMBO_LIMIT:')) {
        setShowCheckoutModal(false);
        toast.error(error.message.slice('COMBO_LIMIT:'.length));
      } else {
        handleFirestoreError(error, OperationType.WRITE, 'tickets');
      }
    } finally {
      saleInFlightRef.current = false;
      setIsSubmittingSale(false);
    }
  };

  const isLotteryOpenForSales = (lot: Lottery) => {
    if (!lot.active) return false;
    if (!lot.closingTime) return true;
    
    try {
      const now = serverNow();
      let currentHour = now.getHours();
      const currentMinutes = now.getMinutes();
      
      // Ajustar para el ciclo de 1 AM a 1 AM
      // Si es antes de la 1 AM, lo tratamos como horas 24, 25, 26
      const adjustedHour = currentHour < 1 ? currentHour + 24 : currentHour;
      const currentTimeVal = adjustedHour * 60 + currentMinutes;

      // Parse closing time safely
      const timeParts = lot.closingTime.match(/(\d+):(\d+)/);
      if (!timeParts) {
        console.warn(`Invalid closing time format for ${lot.name}: ${lot.closingTime}`);
        return true; // Default to open if format is weird
      }
      
      let closeH = parseInt(timeParts[1]);
      let closeM = parseInt(timeParts[2]);
      
      // Si la hora de cierre es antes de la 1 AM, también la ajustamos
      const adjustedCloseH = closeH < 1 ? closeH + 24 : closeH;
      const closeTimeVal = adjustedCloseH * 60 + closeM;

      const isOpen = currentTimeVal < closeTimeVal;
      return isOpen;
    } catch (e) {
      console.error(`Error in isLotteryOpenForSales for ${lot.name}:`, e);
      return true;
    }
  };

  const isBilleteOpenForSales = (lot: Lottery) =>
    isLotteryOpenForSales(lot) && (!lot.billeteClosingTime || isLotteryOpenForSales({ ...lot, closingTime: lot.billeteClosingTime }));

  const isTicketClosed = (ticket: LotteryTicket) => {
    if (!ticket.timestamp) return true;
    const ticketDate = ticket.timestamp?.toDate 
      ? ticket.timestamp.toDate() 
      : (ticket.timestamp ? new Date(ticket.timestamp) : serverNow());
    if (isNaN(ticketDate.getTime())) return true; // Treat invalid dates as closed
    const now = serverNow();
    
    // Definir el "día del sorteo" (que empieza a la 1 AM)
    const getLotteryDay = (date: Date) => {
      const d = new Date(date);
      d.setHours(d.getHours() - 1);
      return format(d, 'yyyy-MM-dd');
    };

    // Si no es el mismo "día de sorteo", está cerrado
    if (getLotteryDay(ticketDate) !== getLotteryDay(now)) return true;

    // Verificar cada apuesta del ticket
    return (ticket.bets || []).some(bet => {
      const lot = lotteries.find(l => cleanText(l.name) === cleanText(bet.lottery));
      if (!lot || !lot.closingTime) return false;

      let currentHour = now.getHours();
      const currentMinutes = now.getMinutes();
      const adjustedHour = currentHour < 1 ? currentHour + 24 : currentHour;
      const currentTimeVal = adjustedHour * 60 + currentMinutes;

      let [closeH, closeM] = lot.closingTime.split(':').map(Number);
      const adjustedCloseH = closeH < 1 ? closeH + 24 : closeH;
      const closeTimeVal = adjustedCloseH * 60 + closeM;

      return currentTimeVal >= closeTimeVal;
    });
  };

  const isTicketHasResults = (ticket: LotteryTicket) => {
    const ticketDate = ticket.timestamp?.toDate ? format(ticket.timestamp.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    return (ticket.bets || []).some(bet => {
      return results.some(r => cleanText(r.lotteryName) === cleanText(bet.lottery) && r.date === ticketDate);
    });
  };

  const getTicketPrizesFromSource = useCallback((
    ticket: LotteryTicket,
    resultsSource: LotteryResult[],
    filterLottery?: string,
    typeFilter?: string
  ) => {
    let totalPrize = 0;
    const winningBets: { idx: number, prize: number, rank: number, lotteryName: string, winningNumber: string, matchType?: string }[] = [];

    if (ticket.status === 'cancelled') return { totalPrize, winningBets };

    const ticketDate = getTicketDateKey(ticket);

    (ticket.bets || []).forEach((bet, idx) => {
      if (filterLottery && cleanText(bet.lottery) !== cleanText(filterLottery)) return;
      if (typeFilter && bet.type !== typeFilter) return;

      const result = resultsSource.find(r => cleanText(r.lotteryName) === cleanText(bet.lottery) && r.date === ticketDate);
      if (!result) return;

      evaluateBetPrizes(bet, result, globalSettings).forEach(hit => {
        totalPrize += hit.prize;
        winningBets.push({ idx, lotteryName: bet.lottery, ...hit });
      });
    });

    return { totalPrize, winningBets };
  }, [getTicketDateKey, globalSettings.billeteMultipliers, globalSettings.billetesEnabled, globalSettings.chancePrices, globalSettings.palesEnabled, globalSettings.pl12Multiplier, globalSettings.pl13Multiplier, globalSettings.pl23Multiplier]);

  const getTicketPrizes = useCallback((ticket: LotteryTicket, filterLottery?: string, typeFilter?: string) => {
    return getTicketPrizesFromSource(ticket, results, filterLottery, typeFilter);
  }, [getTicketPrizesFromSource, results]);

  const buildFinancialSummary = useCallback((params: {
    tickets: LotteryTicket[];
    settlements?: Settlement[];
    userEmail?: string;
    targetDate?: string;
    prizeResolver?: (ticket: LotteryTicket) => { totalPrize: number };
  }) => {
    const {
      tickets: sourceTickets,
      settlements: sourceSettlements = [],
      userEmail,
      targetDate,
      prizeResolver = (ticket: LotteryTicket) => getTicketPrizes(ticket)
    } = params;

    const normalizedEmail = userEmail?.toLowerCase();
    const matchesUser = (email?: string) => !normalizedEmail || (email || '').toLowerCase() === normalizedEmail;

    const validTickets = sourceTickets.filter(ticket => {
      if (ticket.status === 'cancelled') return false;
      if (!matchesUser(ticket.sellerEmail)) return false;
      if (!targetDate) return true;
      return getTicketDateKey(ticket) === targetDate;
    });

    const validSettlements = sourceSettlements.filter(settlement => {
      if (!matchesUser(settlement.userEmail)) return false;
      if (targetDate && settlement.date !== targetDate) return false;
      return true;
    });

    const totalSales = validTickets.reduce((sum, ticket) => sum + (ticket.totalAmount || 0), 0);
    const totalCommissions = validTickets.reduce((sum, ticket) => sum + ((ticket.totalAmount || 0) * ((ticket.commissionRate || 0) / 100)), 0);
    const totalPrizes = validTickets.reduce((sum, ticket) => sum + (prizeResolver(ticket).totalPrize || 0), 0);
    const totalLiquidations = validSettlements.reduce((sum, settlement) => sum + (settlement.amountPaid || 0), 0);
    const netProfit = totalSales - totalCommissions - totalPrizes;

    return {
      tickets: validTickets,
      settlements: validSettlements,
      totalSales,
      totalCommissions,
      totalPrizes,
      totalLiquidations,
      netProfit
    };
  }, [getTicketDateKey, getTicketPrizes]);

  const getLotteryDayStats = useCallback((lotteryName: string, date: string, typeFilter?: string) => {
    const todayStr = businessDayKey;
    const sourceTickets = date === todayStr ? tickets : historyTickets;
    
    const dayTickets = sourceTickets.filter(t => {
      const tDateObj = t.timestamp?.toDate ? t.timestamp.toDate() : (t.timestamp?.seconds ? new Date(t.timestamp.seconds * 1000) : new Date());
      const tDate = format(tDateObj, 'yyyy-MM-dd');
      
      const matchesUser = canAccessAllUsers || t.sellerId === user?.uid || t.sellerEmail?.toLowerCase() === user?.email?.toLowerCase();

      return tDate === date && t.status !== 'cancelled' && matchesUser && t.bets && t.bets.some(b => cleanText(b.lottery) === cleanText(lotteryName) && (!typeFilter || b.type === typeFilter));
    });

    const sales = dayTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []).filter(b => b && b.lottery === lotteryName && (!typeFilter || b.type === typeFilter));
      return acc + lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
    }, 0);

    const commissions = dayTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []).filter(b => b && b.lottery === lotteryName && (!typeFilter || b.type === typeFilter));
      const lotSales = lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
      return acc + (lotSales * (t.commissionRate || 0) / 100);
    }, 0);

    const prizes = dayTickets.reduce((acc, t) => {
      const { totalPrize } = getTicketPrizes(t, lotteryName, typeFilter);
      return acc + totalPrize;
    }, 0);

    const netProfit = sales - commissions - prizes;

    return { sales, commissions, prizes, netProfit, isLoss: netProfit < 0 };
  }, [businessDayKey, canAccessAllUsers, tickets, historyTickets, user?.uid, user?.email]);

  const getStatsByDraw = useCallback((lotteryName: string, date: string) => {
    const todayStr = businessDayKey;
    const sourceTickets = date === todayStr ? tickets : historyTickets;
    
    const dayTickets = sourceTickets.filter(t => {
      const tDateObj = t.timestamp?.toDate ? t.timestamp.toDate() : (t.timestamp?.seconds ? new Date(t.timestamp.seconds * 1000) : new Date());
      const tDate = format(tDateObj, 'yyyy-MM-dd');
      
      const matchesUser = canAccessAllUsers || t.sellerId === user?.uid || t.sellerEmail?.toLowerCase() === user?.email?.toLowerCase();

      return tDate === date && t.status !== 'cancelled' && matchesUser && t.bets && t.bets.some(b => cleanText(b.lottery) === cleanText(lotteryName));
    });

    const pzsVolume = dayTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []).filter(b => b && b.lottery === lotteryName && b.type === 'CH');
      return acc + lotBets.reduce((sum, b) => sum + (b.quantity || 0), 0);
    }, 0);

    const totalMoneyVolume = dayTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []).filter(b => b && b.lottery === lotteryName);
      return acc + lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
    }, 0);

    const totalPrize = dayTickets.reduce((acc, t) => {
      const { totalPrize } = getTicketPrizes(t, lotteryName);
      return acc + totalPrize;
    }, 0);

    return { pzsVolume, totalMoneyVolume, totalPrize, tickets: dayTickets };
  }, [businessDayKey, canAccessAllUsers, tickets, historyTickets, user?.uid, user?.email]);

  const getUserLotteryDayStats = (userEmail: string, lotteryName: string, date: string, typeFilter?: string) => {
    const todayStr = businessDayKey;
    const sourceTickets = date === todayStr ? tickets : historyTickets;
    
    const dayTickets = sourceTickets.filter(t => {
      const tDate = t.timestamp?.toDate ? format(t.timestamp.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
      return tDate === date && t.status !== 'cancelled' && t.sellerEmail?.toLowerCase() === userEmail?.toLowerCase() && t.bets && t.bets.some(b => b.lottery === lotteryName && (!typeFilter || b.type === typeFilter));
    });

    const sales = dayTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []).filter(b => b && b.lottery === lotteryName && (!typeFilter || b.type === typeFilter));
      return acc + lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
    }, 0);

    const commissions = dayTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []).filter(b => b && b.lottery === lotteryName && (!typeFilter || b.type === typeFilter));
      const lotSales = lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
      return acc + (lotSales * (t.commissionRate || 0) / 100);
    }, 0);

    const prizes = dayTickets.reduce((acc, t) => {
      const { totalPrize } = getTicketPrizes(t, lotteryName, typeFilter);
      return acc + totalPrize;
    }, 0);

    const netProfit = sales - commissions - prizes;

    return { sales, commissions, prizes, netProfit, isLoss: netProfit < 0 };
  };



  const globalStats = useMemo(() => {
    const typeFilterCode = historyFilter === 'CHANCE' ? 'CH' : 
                          historyFilter === 'BILLETE' ? 'BL' : 
                          historyFilter === 'PALE' ? 'PL' : undefined;
    
    let totalSales = 0;
    let totalCommissions = 0;
    let totalPrizes = 0;

    lotteries.forEach(lot => {
      const { sales, commissions, prizes } = getLotteryDayStats(lot.name, historyDate, typeFilterCode);
      totalSales += sales;
      totalCommissions += commissions;
      totalPrizes += prizes;
    });

    const totalNetProfit = totalSales - totalCommissions - totalPrizes;
    const totalBankProfit = totalSales - totalCommissions - totalPrizes;
    
    return { 
      sales: totalSales, 
      commissions: totalCommissions, 
      prizes: totalPrizes, 
      bankProfit: totalBankProfit,
      netProfit: totalNetProfit,
      isLoss: totalNetProfit < 0 
    };
  }, [lotteries, getLotteryDayStats, historyDate, historyFilter, userProfile]);

  const getOperationalTimeSortValue = useCallback((time: string) => {
    const [h, m] = time.split(':').map(Number);
    let val = h * 60 + m;
    if (val < 11 * 60) {
      val += 24 * 60; // Keep early-morning draws after late-night draws
    }
    return val;
  }, []);

  const sortedLotteries = [...lotteries].sort((a, b) => {
    return getOperationalTimeSortValue(a.drawTime || '00:00') - getOperationalTimeSortValue(b.drawTime || '00:00');
  });
  const activeLotteries = useMemo(() => {
    const seenNames = new Set<string>();
    return sortedLotteries
      .filter(l => isLotteryOpenForSales(l))
      .filter(lottery => {
        const key = normalizeLotteryName(lottery.name);
        if (!key || seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });
  }, [sortedLotteries]);
  const findActiveLotteryByName = useCallback((name: string) => {
    const key = normalizeLotteryName(name);
    return activeLotteries.find(l => normalizeLotteryName(l.name) === key);
  }, [activeLotteries]);
  const canManageResults = userProfile?.role === 'ceo' || userProfile?.role === 'admin' || userProfile?.role === 'programador';
  const isCeoUser = userProfile?.role === 'ceo' || userProfile?.role === 'programador';
  const sortedResults = useMemo(() => sortResultsByRecency(results), [results, sortResultsByRecency]);
  const operationalResults = useMemo(() => {
    return sortedResults.filter(result => result.date === businessDayKey);
  }, [businessDayKey, sortedResults]);
  const lotteryById = useMemo(() => {
    return new Map(sortedLotteries.map(lottery => [lottery.id, lottery]));
  }, [sortedLotteries]);
  const visibleResults = useMemo(() => {
    const orderedByDrawTime = [...operationalResults].sort((a, b) => {
      const aTime = lotteryById.get(a.lotteryId)?.drawTime || '00:00';
      const bTime = lotteryById.get(b.lotteryId)?.drawTime || '00:00';
      const timeDiff = getOperationalTimeSortValue(aTime) - getOperationalTimeSortValue(bTime);
      if (timeDiff !== 0) return timeDiff;
      return (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0);
    });
    return canManageResults ? orderedByDrawTime.slice(0, 200) : orderedByDrawTime.slice(0, 80);
  }, [canManageResults, getOperationalTimeSortValue, lotteryById, operationalResults]);

  const takenResultLotteryIdsForDate = useMemo(() => {
    const used = new Set<string>();
    sortedResults.forEach(result => {
      if (result.date === businessDayKey && result.lotteryId) {
        used.add(result.lotteryId);
      }
    });
    return used;
  }, [businessDayKey, sortedResults]);

  const resultListItems = useMemo(() => {
    const items: Array<{ key: string; time: number; res?: LotteryResult; lottery?: Lottery }> = visibleResults.map(res => ({
      key: res.id,
      time: getOperationalTimeSortValue(lotteryById.get(res.lotteryId)?.drawTime || '00:00'),
      res
    }));
    if (canManageResults) {
      sortedLotteries
        .filter(lottery => lottery.active && !takenResultLotteryIdsForDate.has(lottery.id))
        .forEach(lottery => items.push({
          key: `pending-${lottery.id}`,
          time: getOperationalTimeSortValue(lottery.drawTime || '00:00'),
          lottery
        }));
    }
    return items.sort((a, b) => a.time - b.time);
  }, [canManageResults, getOperationalTimeSortValue, lotteryById, sortedLotteries, takenResultLotteryIdsForDate, visibleResults]);

  const availableResultLotteries = useMemo(() => {
    return sortedLotteries.filter(lottery =>
      (
        lottery.active ||
        lottery.id === editingResult?.lotteryId
      ) &&
      (
        !takenResultLotteryIdsForDate.has(lottery.id) ||
        lottery.id === editingResult?.lotteryId
      )
    );
  }, [editingResult?.lotteryId, sortedLotteries, takenResultLotteryIdsForDate]);

  const resultStatusMap = useMemo(() => {
    const map = new Map<string, { sales: number; prizes: number; hasWinners: boolean }>();
    if (!canManageResults || !user?.uid) return map;

    const currentEmail = (user.email || '').toLowerCase();
    const ownTickets = tickets.filter(ticket =>
      ticket.status !== 'cancelled' &&
      (
        ticket.sellerId === user.uid ||
        (ticket.sellerEmail || '').toLowerCase() === currentEmail
      )
    );

    visibleResults.forEach(result => {
      let sales = 0;
      let prizes = 0;

      ownTickets.forEach(ticket => {
        if (getTicketDateKey(ticket) !== result.date) return;
        const matchingBets = (ticket.bets || []).filter(bet => cleanText(bet.lottery) === cleanText(result.lotteryName));
        if (!matchingBets.length) return;
        sales += matchingBets.reduce((sum, bet) => sum + (bet.amount || 0), 0);
        prizes += getTicketPrizesFromSource(ticket, [result], result.lotteryName).totalPrize;
      });

      map.set(getResultKey(result), { sales, prizes, hasWinners: prizes > 0 });
    });

    return map;
  }, [canManageResults, getResultKey, getTicketDateKey, getTicketPrizesFromSource, tickets, user?.email, user?.uid, visibleResults]);

  // Auto-select first active lottery if none selected or current is closed
  useEffect(() => {
    if (activeLotteries.length > 0) {
      if (!isMultipleMode) {
        if (!selectedLottery || !findActiveLotteryByName(selectedLottery)) {
          setSelectedLottery(activeLotteries[0].name);
        }
      } else {
        // Filter closed lotteries from multiLottery
        const validMulti = multiLottery.filter(name => !!findActiveLotteryByName(name));
        if (validMulti.length !== multiLottery.length) {
          setMultiLottery(validMulti);
        }
      }
    } else {
      if (selectedLottery !== '') setSelectedLottery('');
      if (multiLottery.length > 0) setMultiLottery([]);
    }
  }, [activeLotteries, findActiveLotteryByName, isMultipleMode, selectedLottery, multiLottery]);

  useEffect(() => {
    if (betType === 'BL') {
      const supportsBL = globalSettings.billetesEnabled && (isMultipleMode 
        ? multiLottery.some(name => { const l = findActiveLotteryByName(name); return lotteryAllowsBillete(l) && !!l && isBilleteOpenForSales(l); })
        : (() => { const l = findActiveLotteryByName(selectedLottery); return lotteryAllowsBillete(l) && !!l && isBilleteOpenForSales(l); })());
      
      if (!supportsBL) {
        setBetType('CH');
        setNumber('');
      }
    } else if (betType === 'PL') {
      const supportsPL = globalSettings.palesEnabled && (isMultipleMode
        ? multiLottery.some(name => lotteryAllowsPale(findActiveLotteryByName(name)))
        : lotteryAllowsPale(findActiveLotteryByName(selectedLottery)));

      if (!supportsPL) {
        setBetType('CH');
        setNumber('');
      }
    }
  }, [betType, findActiveLotteryByName, globalSettings.billetesEnabled, globalSettings.palesEnabled, isMultipleMode, multiLottery, selectedLottery, tick]);

  const cancelTicket = async (id: string) => {
    const ticket = tickets.find(t => t.id === id);
    if (!ticket) return;

    if (ticket.sellerEmail?.toLowerCase() !== user?.email?.toLowerCase()) {
      toast.error('No tienes permiso para borrar esta venta. Solo el vendedor original puede hacerlo.');
      return;
    }

    if (isTicketClosed(ticket)) {
      toast.error('No se puede borrar esta venta: El sorteo ya ha cerrado.');
      return;
    }

    if (isTicketHasResults(ticket)) {
      toast.error('No se puede borrar esta venta: El sorteo ya tiene resultados.');
      return;
    }

    setConfirmModal({
      show: true,
      title: 'Borrar Venta',
      message: '¿Está seguro de borrar esta venta? Se eliminará permanentemente de la base de datos.',
      onConfirm: async () => {
        try {
          await commitWithComboCounters([], ticket.bets || [], (transaction) => {
            transaction.delete(doc(db, 'tickets', id));
          });
          toast.success('Venta eliminada correctamente');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `tickets/${id}`);
        }
      }
    });
  };

  const handleNativeShare = async (ticket: LotteryTicket, lotteryName?: string) => {
    if (!ticket) return;
    
    const ticketId = ticket.id.slice(0, 8).toUpperCase();
    const date = ticket.timestamp && typeof ticket.timestamp.toDate === 'function' 
      ? format(ticket.timestamp.toDate(), 'dd/MM/yyyy HH:mm') 
      : format(new Date(), 'dd/MM/yyyy HH:mm');
    
    let message = `*CHANCE PRO - TICKET DE LOTERÍA*\n`;
    message += `--------------------------------\n`;
    message += `*Ticket:* #${ticketId}\n`;
    message += `*Vendedor:* ${ticket.sellerCode || '---'}\n`;
    message += `*Fecha:* ${date}\n`;
    message += `--------------------------------\n`;
    
    const betsToShare = lotteryName
      ? (ticket.bets || []).filter(b => b.lottery === lotteryName)
      : (ticket.bets || []);

    if (betsToShare.length === 0) return;

    betsToShare.forEach((bet, idx) => {
      message += `${idx + 1}. ${cleanText(bet.lottery)} - ${getBetTypeLabel(bet.type)} ${bet.number} - $${bet.amount}\n`;
    });
    
    const totalAmount = betsToShare.reduce((sum, b) => sum + (b.amount || 0), 0);
    
    message += `--------------------------------\n`;
    message += `*TOTAL:* $${totalAmount.toFixed(2)} USD\n`;
    message += `--------------------------------\n`;
    message += `_¡Buena Suerte!_`;

    const shareData = {
      title: 'Ticket de Lotería - Chance Pro',
      text: message
    };

    const fallbackToWhatsApp = async () => {
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, '_blank');
      try {
        await navigator.clipboard.writeText(message);
        toast.success('Abriendo WhatsApp... (Texto copiado)');
      } catch (err) {
        // Ignore clipboard error
      }
    };

    if (navigator.share && (navigator.canShare ? navigator.canShare(shareData) : true)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error(err);
          await fallbackToWhatsApp();
        }
      }
    } else {
      await fallbackToWhatsApp();
    }
  };

  const reuseTicket = (ticket: LotteryTicket) => {
    if (ticket.sellerEmail?.toLowerCase() !== user?.email?.toLowerCase()) {
      toast.error('No tienes permiso para reutilizar esta venta. Solo el seller original puede hacerlo.');
      return;
    }
    setReuseModal({ show: true, ticket });
  };

  const handleReuseSelect = (lotteryName: string) => {
    if (!reuseModal.ticket) return;
    const newBets = reuseModal.ticket.bets.map(b => ({ ...b, lottery: lotteryName }));
    
    setCart(prevCart => {
      const combined = [...prevCart, ...newBets];
      return unifyBets(combined);
    });
    
    setActiveTab('sales');
    toast.info(`Lista duplicada y unificada para ${cleanText(lotteryName)}`);
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmPassword) {
      toast.error('Por favor, complete todos los campos');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        toast.success('Contraseña actualizada correctamente');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        throw new Error('No hay un usuario autenticado');
      }
    } catch (error: any) {
      console.error('Error updating password:', error);
      if (error.code === 'auth/requires-recent-login') {
        toast.error('Por seguridad, debe cerrar sesión e iniciarla de nuevo para cambiar su contraseña.');
      } else {
        toast.error(`Error: ${error.message || 'No se pudo actualizar la contraseña'}`);
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const loadNativeBluetoothPrinters = async () => {
    setIsLoadingNativePrinters(true);
    try {
      await NativeBluetoothPrinter.requestPermissions();
      const result = await NativeBluetoothPrinter.listBondedDevices();
      setNativeBluetoothPrinters(result.devices || []);
      if (!selectedNativePrinterAddress && result.devices?.length) {
        setSelectedNativePrinterAddress(result.devices[0].address);
      }
      if (!result.devices?.length) {
        toast.info('No hay impresoras vinculadas. Vincula la impresora en los ajustes Bluetooth de Android.');
      }
    } catch (error: any) {
      console.error('Error loading native printers:', error);
      toast.error(error?.message || 'No se pudieron leer las impresoras vinculadas');
    } finally {
      setIsLoadingNativePrinters(false);
    }
  };

  const handleConnectBluetoothPrinter = async () => {
    setIsConnectingPrinter(true);
    const toastId = toast.loading('Buscando impresora Bluetooth...');
    try {
      if (isNativeAndroid()) {
        await NativeBluetoothPrinter.requestPermissions();
        const result = await NativeBluetoothPrinter.listBondedDevices();
        const devices = result.devices || [];
        setNativeBluetoothPrinters(devices);
        const selectedDevice = devices.find(device => device.address === selectedNativePrinterAddress) || devices[0];

        if (!selectedDevice) {
          throw new Error('No hay impresoras vinculadas. Vincula la impresora en Android y vuelve a intentar.');
        }

        const config: BluetoothPrinterConfig = {
          deviceId: selectedDevice.address,
          deviceAddress: selectedDevice.address,
          deviceName: selectedDevice.name || 'Impresora Bluetooth',
          profileId: 'native-spp',
          serviceUuid: 'native-spp',
          characteristicUuid: 'native-spp',
          paperWidth: selectedPrinterPaperWidth,
          connectedAt: new Date().toISOString()
        };
        saveBluetoothPrinterConfig(config);
        setBluetoothPrinterConfig(config);
        setSelectedNativePrinterAddress(selectedDevice.address);
        toast.success(`Impresora guardada: ${config.deviceName}`, { id: toastId });
        return;
      }

      const config = await connectBluetoothPrinter(selectedBluetoothPrinterProfileId, selectedPrinterPaperWidth);
      setBluetoothPrinterConfig(config);
      setSelectedBluetoothPrinterProfileId(config.profileId);
      setSelectedPrinterPaperWidth(config.paperWidth);
      toast.success(`Impresora conectada: ${config.deviceName}`, { id: toastId });
    } catch (error: any) {
      console.error('Error connecting Bluetooth printer:', error);
      toast.error(error?.message || 'No se pudo conectar la impresora', { id: toastId });
    } finally {
      setIsConnectingPrinter(false);
    }
  };

  const handleTestBluetoothPrinter = async () => {
    const width = selectedPrinterPaperWidth === '80' ? 42 : 32;
    const testText = [
      centerReceiptLine('CHANCE PRO', width),
      centerReceiptLine('PRUEBA DE IMPRESION', width),
      '-'.repeat(width),
      `Fecha: ${format(new Date(), 'dd/MM/yyyy hh:mm a')}`,
      `Usuario: ${userProfile?.name || userProfile?.email || 'Terminal'}`,
      '-'.repeat(width),
      centerReceiptLine('Impresora lista', width)
    ].join('\n');
    const toastId = toast.loading('Enviando prueba...');
    try {
      await printEscPosText(testText);
      toast.success('Prueba enviada a la impresora', { id: toastId });
    } catch (error: any) {
      console.error('Error testing Bluetooth printer:', error);
      toast.error(error?.message || 'No se pudo imprimir la prueba', { id: toastId });
    }
  };

  const handleForgetBluetoothPrinter = () => {
    saveBluetoothPrinterConfig(null);
    setBluetoothPrinterConfig(null);
    setSelectedNativePrinterAddress('');
    toast.success('Impresora eliminada de esta terminal');
  };

  const saveUser = async (userProfileData: UserProfile, password?: string) => {
    const rawEmail = userProfileData.email.toLowerCase();
    const authEmail = rawEmail.includes('@') ? rawEmail : `${rawEmail}@chancepro.local`;

    if (userProfileData.role === 'admin') {
      const adminCount = users.filter(u => u.role === 'admin' && u.email !== authEmail).length;
      if (adminCount >= 5) {
        toast.error('Límite máximo de 5 administradores alcanzado');
        return;
      }
    }

    if (userProfileData.role === 'ceo') {
      const ceoCount = users.filter(u => u.role === 'ceo' && u.email !== authEmail).length;
      if (ceoCount >= 3) {
        toast.error('Límite máximo de 3 CEO alcanzado');
        return;
      }
    }

    try {
      // Automate sellerId generation for new users (all roles)
      if (!userProfileData.sellerId) {
        await runTransaction(db, async (transaction) => {
          const settingsDoc = await transaction.get(doc(db, 'settings', 'global'));
          if (!settingsDoc.exists()) throw new Error("Configuración global no encontrada");
          
          const nextNum = settingsDoc.data().nextSellerNumber || 2;
          const rolePrefix =
            userProfileData.role === 'ceo'
              ? 'CEO'
              : userProfileData.role === 'admin'
                ? 'ADM'
                : userProfileData.role === 'programador'
                  ? 'DEV'
                  : 'VEND';
          const newSellerId = `${rolePrefix}${nextNum.toString().padStart(2, '0')}`;
          
          userProfileData.sellerId = newSellerId;
          userProfileData.name = newSellerId;
          
          transaction.update(doc(db, 'settings', 'global'), {
            nextSellerNumber: nextNum + 1
          });
        });
      }

      if (password) {
        if (!secondaryAuth) {
          throw new Error('Servicio de autenticación secundaria no disponible');
        }
        // Create user in Firebase Auth using secondary app to avoid signing out the CEO
        try {
          await signOut(secondaryAuth).catch(() => undefined);
          await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
        } catch (authError: any) {
          if (authError.code === 'auth/email-already-in-use') {
            toast.info('El usuario ya existe en el sistema. Actualizando su perfil...');
          } else {
            throw authError;
          }
        } finally {
          await signOut(secondaryAuth).catch(() => undefined);
        }
        // Ensure the email saved in Firestore is the one used for auth
        userProfileData.email = authEmail;
      } else if (!userProfileData.email.includes('@')) {
        userProfileData.email = authEmail;
      }

      if (editingUser?.preferredChancePrice !== undefined && userProfileData.preferredChancePrice === undefined) {
        userProfileData.preferredChancePrice = editingUser.preferredChancePrice;
      }

      // Firestore does not support undefined values. Strip them out.
      const normalizedFirestoreEmail = (userProfileData.email || authEmail).toLowerCase();
      userProfileData.email = normalizedFirestoreEmail;
      const cleanData = Object.fromEntries(
        Object.entries(userProfileData).filter(([_, v]) => v !== undefined)
      );

      await setDoc(doc(db, 'users', normalizedFirestoreEmail), cleanData);
      
      if (editingUser?.email?.toLowerCase() === userProfile?.email?.toLowerCase()) {
        setUserProfile(cleanData as UserProfile);
      }
      
      toast.success('Usuario guardado correctamente');
      setShowUserModal(false);
      setEditingUser(null);
    } catch (error: any) {
      console.error('Error saving user:', error);
      if (error.code === 'auth/email-already-in-use') {
        toast.error('El usuario ya existe');
      } else if (error.code === 'auth/invalid-email') {
        toast.error('El formato del usuario es inválido');
      } else if (error.code === 'auth/weak-password') {
        toast.error('La contraseña es muy débil');
      } else if (error.code === 'auth/admin-restricted-operation') {
        toast.error('Error: El registro de usuarios está restringido. Por favor, habilite "Permitir que los usuarios se registren" en la consola de Firebase (Authentication > Settings > User actions).');
      } else if (error.code === 'auth/operation-not-allowed') {
        toast.error('El registro de usuarios no está habilitado en Firebase');
      } else {
        toast.error(`Error: ${error.message || 'No se pudo guardar el usuario'}`);
      }
    }
  };

  const deleteUser = async (email: string) => {
    setConfirmModal({
      show: true,
      title: 'Eliminar Usuario',
      message: '¿Está seguro de eliminar este usuario? Perderá acceso al sistema.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', email));
          toast.success('Usuario eliminado correctamente');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${email}`);
        }
      }
    });
  };

  const editTicket = async (ticket: LotteryTicket) => {
    if (ticket.sellerEmail?.toLowerCase() !== user?.email?.toLowerCase()) {
      toast.error('No tienes permiso para editar esta venta. Solo el vendedor original puede hacerlo.');
      return;
    }

    if (isTicketClosed(ticket)) {
      toast.error('No se puede editar esta venta: El sorteo ya ha cerrado.');
      return;
    }

    if (isTicketHasResults(ticket)) {
      toast.error('No se puede editar esta venta: El sorteo ya tiene resultados.');
      return;
    }

    setConfirmModal({
      show: true,
      title: 'Editar Venta',
      message: 'Se cargarán las apuestas al carrito para modificarlas. El ticket original se mantendrá hasta que confirmes los cambios. ¿Continuar?',
      onConfirm: () => {
        const uniqueTicketLotteries = Array.from(new Set(
          (ticket.bets || [])
            .map(b => (b?.lottery || '').trim())
            .filter(Boolean)
        ));

        setCart(ticket.bets);
        setEditingTicketId(ticket.id);
        setCustomerName(ticket.customerName || '');
        if (uniqueTicketLotteries.length > 1) {
          setIsMultipleMode(true);
          setMultiLottery(uniqueTicketLotteries);
          setSelectedLottery('');
        } else {
          setIsMultipleMode(false);
          setMultiLottery([]);
          setSelectedLottery(uniqueTicketLotteries[0] || '');
        }
        setActiveTab('sales');
        toast.info('Modo edici?n activado. Realice los cambios y genere el ticket para actualizar.');
      }
    });
  };

  const cancelEdit = () => {
    setEditingTicketId(null);
    setCart([]);
    setCustomerName('');
    toast.info('Edición cancelada');
  };

  const editCartItem = (idx: number) => {
    const item = cart[idx];
    setNumber(item.number);
    setBetType(item.type);
    if (item.type === 'CH') {
      setQuantity(item.quantity.toString());
      setChancePrice(getBetUnitPrice(item));
    } else {
      setPlAmount((item.amount / item.quantity).toString());
      setQuantity(item.quantity.toString());
    }
    setSelectedLottery(item.lottery);
    removeFromCart(idx);
    toast.info('Apuesta cargada para editar');
  };

  const saveLottery = async (lotteryData: Partial<Lottery>) => {
    try {
      const normalizedName = normalizeLotteryName(lotteryData.name || '');
      if (!normalizedName) {
        toast.error('Ingrese un nombre de sorteo válido');
        return;
      }

      const hasDuplicateName = lotteries.some(lottery => {
        if (editingLottery && lottery.id === editingLottery.id) return false;
        return normalizeLotteryName(lottery.name) === normalizedName;
      });

      if (hasDuplicateName) {
        toast.error('Ya existe un sorteo con ese nombre. Use un nombre único.');
        return;
      }

      if (editingLottery) {
        await updateDoc(doc(db, 'lotteries', editingLottery.id), lotteryData);
        toast.success('Lotería actualizada');
      } else {
        await addDoc(collection(db, 'lotteries'), {
          ...lotteryData,
          active: lotteryData.active !== false
        });
        toast.success('Lotería agregada');
      }
      setShowLotteryModal(false);
      setEditingLottery(null);
    } catch (error) {
      handleFirestoreError(error, editingLottery ? OperationType.UPDATE : OperationType.CREATE, 'lotteries');
    }
  };

  const toggleLotteryActive = async (lottery: Lottery) => {
    try {
      await updateDoc(doc(db, 'lotteries', lottery.id), { active: !lottery.active });
      toast.success(`Lotería ${lottery.active ? 'pausada' : 'activada'}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `lotteries/${lottery.id}`);
    }
  };

  const deleteLottery = async (id: string) => {
    setConfirmModal({
      show: true,
      title: 'Eliminar Lotería',
      message: '¿Está seguro de eliminar esta lotería? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'lotteries', id));
          toast.success('Lotería eliminada');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `lotteries/${id}`);
        }
      }
    });
  };

  const resetResultForm = useCallback(() => {
    setResultFormLotteryId('');
    setResultFormFirstPrize('');
    setResultFormSecondPrize('');
    setResultFormThirdPrize('');
  }, []);

  const cancelResultEdition = useCallback(() => {
    setEditingResult(null);
    resetResultForm();
  }, [resetResultForm]);

  const closeResultEditor = useCallback(() => {
    setResultEditorOpen(false);
    cancelResultEdition();
  }, [cancelResultEdition]);

  const openResultEditor = useCallback((lotteryId: string, existing?: LotteryResult) => {
    if (existing) {
      setEditingResult(existing);
    } else {
      setEditingResult(null);
      setResultFormLotteryId(lotteryId);
      setResultFormFirstPrize('');
      setResultFormSecondPrize('');
      setResultFormThirdPrize('');
    }
    setResultEditorOpen(true);
  }, []);

  useEffect(() => {
    if (!editingResult) return;
    setResultFormLotteryId(editingResult.lotteryId);
    setResultFormFirstPrize(editingResult.firstPrize);
    setResultFormSecondPrize(editingResult.secondPrize);
    setResultFormThirdPrize(editingResult.thirdPrize);
  }, [editingResult]);

  const handleCreateResultFromForm = useCallback(async () => {
    if (!canManageResults) {
      toast.error('No tiene permisos para ingresar resultados');
      return;
    }
    if (!resultFormLotteryId || !resultFormFirstPrize || !resultFormSecondPrize || !resultFormThirdPrize) {
      toast.error('Complete todos los campos del resultado');
      return;
    }

    if (editingResult && editingResult.date !== businessDayKey) {
      toast.error('Solo se pueden editar resultados de la fecha operativa actual');
      return;
    }

    const selectedLottery = sortedLotteries.find(lottery => lottery.id === resultFormLotteryId);
    if (!selectedLottery) {
      toast.error('Seleccione un sorteo válido');
      return;
    }
    const requiredDigits = selectedLottery.isFourDigits ? 4 : 2;
    if (![resultFormFirstPrize, resultFormSecondPrize, resultFormThirdPrize].every(v => v.length === requiredDigits)) {
      toast.error('Cada premio debe tener exactamente ' + requiredDigits + ' cifras');
      return;
    }

    const alreadyExists = results.some(result =>
      result.lotteryId === resultFormLotteryId &&
      result.date === businessDayKey &&
      result.id !== editingResult?.id
    );
    if (alreadyExists) {
      toast.error('Ese sorteo ya tiene resultado para la fecha seleccionada');
      return;
    }

    const saved = await saveResult({
      lotteryId: resultFormLotteryId,
      lotteryName: cleanText(selectedLottery.name),
      date: businessDayKey,
      firstPrize: resultFormFirstPrize,
      secondPrize: resultFormSecondPrize,
      thirdPrize: resultFormThirdPrize
    });

    if (saved) {
      resetResultForm();
      setEditingResult(null);
      setResultEditorOpen(false);
    }
  }, [businessDayKey, canManageResults, editingResult, resetResultForm, resultFormFirstPrize, resultFormLotteryId, resultFormSecondPrize, resultFormThirdPrize, results, sortedLotteries]);

  const saveResult = async (resultData: Partial<LotteryResult>) => {
    if (!canManageResults) {
      toast.error('No tiene permisos para guardar resultados');
      return false;
    }

    if (resultData.date !== businessDayKey) {
      toast.error('Solo se pueden guardar resultados para la fecha operativa actual');
      return false;
    }

    const duplicate = results.some(result =>
      result.lotteryId === resultData.lotteryId &&
      result.date === resultData.date &&
      result.id !== editingResult?.id
    );
    if (duplicate) {
      toast.error('Ese sorteo ya tiene resultado para esa fecha');
      return false;
    }

    try {
      if (editingResult) {
        await updateDoc(doc(db, 'results', editingResult.id), {
          ...resultData,
          timestamp: serverTimestamp()
        });
        toast.success('Resultado actualizado');
      } else {
        await addDoc(collection(db, 'results'), {
          ...resultData,
          timestamp: serverTimestamp()
        });
        toast.success('Resultado ingresado');
      }
      setEditingResult(null);
      return true;
    } catch (error) {
      handleFirestoreError(error, editingResult ? OperationType.UPDATE : OperationType.CREATE, 'results');
      return false;
    }
  };

  const deleteResult = async (id: string) => {
    if (!canManageResults) {
      toast.error('No tiene permisos para eliminar resultados');
      return;
    }
    setConfirmModal({
      show: true,
      title: 'Eliminar Resultado',
      message: '¿Está seguro de eliminar este resultado? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'results', id));
          toast.success('Resultado eliminado');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `results/${id}`);
        }
      }
    });
  };

  const allLiquidationUsersValue = '__ALL__';
  const canChooseLiquidationUser = userProfile?.role === 'ceo' || userProfile?.role === 'admin' || userProfile?.role === 'programador';
  const canConfirmLiquidation = !!userProfile && ['ceo', 'admin', 'programador'].includes(userProfile.role);
  const selectedLiquidationIsAll = selectedUserToLiquidate === allLiquidationUsersValue;
  const signedCurrency = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}USD ${Math.abs(value || 0).toFixed(2)}`;
  const signedAmountClass = (value: number) => value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-muted-foreground';

  const liquidationScopeEmail = canChooseLiquidationUser
    ? selectedUserToLiquidate
    : (userProfile?.email || '').toLowerCase();
  const liquidationEnd = liquidationEndDate && liquidationEndDate > liquidationDate ? liquidationEndDate : liquidationDate;
  const liquidationDateLabel = liquidationEnd === liquidationDate ? liquidationDate : `${liquidationDate} al ${liquidationEnd}`;

  const liquidationReport = useMemo(() => {
    if (activeTab !== 'liquidaciones') return null;
    const includeToday = liquidationDate <= businessDayKey && businessDayKey <= liquidationEnd;
    const sourceTickets = [...(includeToday ? tickets : []), ...liquidationTicketsSnapshot];
    const sourceResults = [...(includeToday ? results : []), ...liquidationResultsSnapshot];
    const scopeAll = liquidationScopeEmail === allLiquidationUsersValue;
    const round = (value: number) => Number(value.toFixed(2));

    type LiquidationDrawRow = { key: string; name: string; time: string; sales: number; prizes: number; commission: number; utility: number };
    type LiquidationUserRow = { key: string; label: string; sales: number; prizes: number; commission: number; utility: number; draws: Map<string, LiquidationDrawRow> };
    const userRows = new Map<string, LiquidationUserRow>();
    const globalDraws = new Map<string, LiquidationDrawRow>();
    const addToDraw = (map: Map<string, LiquidationDrawRow>, key: string, name: string, sales: number, prizes: number, commission: number) => {
      const row = map.get(key) ?? {
        key,
        name,
        time: (() => {
          const lot = lotteries.find(l => cleanText(l.name) === key);
          return lot?.drawTime ? formatTime12h(lot.drawTime) : '';
        })(),
        sales: 0,
        prizes: 0,
        commission: 0,
        utility: 0
      };
      row.sales += sales;
      row.prizes += prizes;
      row.commission += commission;
      row.utility += sales - prizes - commission;
      map.set(key, row);
    };

    sourceTickets.forEach(ticket => {
      if (!ticket || ticket.status === 'cancelled') return;
      const email = (ticket.sellerEmail || '').toLowerCase();
      if (!scopeAll && email !== liquidationScopeEmail.toLowerCase()) return;

      const userKey = email || String(ticket.sellerId || ticket.sellerName || 'sin-usuario').toLowerCase();
      const profile = users.find(u => (u.email || '').toLowerCase() === email);
      const userRow = userRows.get(userKey) ?? {
        key: userKey,
        label: getUserLabel({ email: email || profile?.email, name: profile?.name || ticket.sellerName }) || 'Usuario',
        sales: 0,
        prizes: 0,
        commission: 0,
        utility: 0,
        draws: new Map<string, LiquidationDrawRow>()
      };
      const rate = (ticket.commissionRate || 0) / 100;
      const lotteryNames = Array.from(new Set((ticket.bets || []).map(bet => bet?.lottery).filter(Boolean)));
      lotteryNames.forEach(lotteryName => {
        const drawKey = cleanText(lotteryName);
        const sales = (ticket.bets || [])
          .filter(bet => bet && cleanText(bet.lottery) === drawKey)
          .reduce((sum, bet) => sum + (bet.amount || 0), 0);
        const prizes = getTicketPrizesFromSource(ticket, sourceResults, lotteryName).totalPrize || 0;
        const commission = sales * rate;
        userRow.sales += sales;
        userRow.prizes += prizes;
        userRow.commission += commission;
        userRow.utility += sales - prizes - commission;
        addToDraw(userRow.draws, drawKey, drawKey, sales, prizes, commission);
        addToDraw(globalDraws, drawKey, drawKey, sales, prizes, commission);
      });
      userRows.set(userKey, userRow);
    });

    const finish = <T extends { sales: number; prizes: number; commission: number; utility: number }>(row: T): T => ({
      ...row,
      sales: round(row.sales),
      prizes: round(row.prizes),
      commission: round(row.commission),
      utility: round(row.utility)
    });
    const finishDraws = (map: Map<string, LiquidationDrawRow>) => Array.from(map.values())
      .map(finish)
      .sort((a, b) => a.name.localeCompare(b.name));
    const usersList = Array.from(userRows.values())
      .map(row => ({ ...finish(row), draws: finishDraws(row.draws) }))
      .filter(row => row.sales > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
    const totals = usersList.reduce((sum, row) => ({
      sales: sum.sales + row.sales,
      prizes: sum.prizes + row.prizes,
      commission: sum.commission + row.commission,
      utility: sum.utility + row.utility
    }), { sales: 0, prizes: 0, commission: 0, utility: 0 });

    return {
      users: usersList,
      draws: finishDraws(globalDraws),
      totals: finish(totals)
    };
  }, [activeTab, allLiquidationUsersValue, businessDayKey, getTicketPrizesFromSource, liquidationDate, liquidationEnd, liquidationResultsSnapshot, liquidationScopeEmail, liquidationTicketsSnapshot, lotteries, results, tickets, users]);

  const shareLiquidationPdf = async () => {
    if (!liquidationReport) return;
    const isGlobal = liquidationScopeEmail === allLiquidationUsersValue;
    const toastId = toast.loading('Generando liquidación...');
    setIsSharingLiquidation(true);
    try {
      const pdf = createReportPdf();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      let y = 16;
      const money = (value: number) => `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
      const colRight = [pageWidth - margin - 78, pageWidth - margin - 52, pageWidth - margin - 26, pageWidth - margin];
      const ensureSpace = (height: number) => {
        if (y + height > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
      };
      const tableHeader = (firstColumn: string) => {
        ensureSpace(14);
        pdf.setFillColor(241, 245, 249);
        pdf.rect(margin, y - 4.5, pageWidth - margin * 2, 7, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(71, 85, 105);
        pdf.text(firstColumn, margin + 2, y);
        ['VENTA', 'PREMIOS', 'COMISION', 'UTILIDAD'].forEach((title, index) => pdf.text(title, colRight[index], y, { align: 'right' }));
        y += 6;
      };
      const tableRow = (label: string, row: { sales: number; prizes: number; commission: number; utility: number }, bold = false) => {
        ensureSpace(7);
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        pdf.setFontSize(8.5);
        pdf.setTextColor(30, 41, 59);
        pdf.text(label, margin + 2, y, { maxWidth: colRight[0] - margin - 22 });
        pdf.text(money(row.sales), colRight[0], y, { align: 'right' });
        pdf.setTextColor(190, 18, 60);
        pdf.text(money(row.prizes), colRight[1], y, { align: 'right' });
        pdf.setTextColor(29, 78, 216);
        pdf.text(money(row.commission), colRight[2], y, { align: 'right' });
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(row.utility >= 0 ? 4 : 190, row.utility >= 0 ? 120 : 18, row.utility >= 0 ? 87 : 60);
        pdf.text(money(row.utility), colRight[3], y, { align: 'right' });
        pdf.setDrawColor(226, 232, 240);
        pdf.line(margin, y + 2, pageWidth - margin, y + 2);
        y += 6.5;
      };
      const sectionTitle = (title: string) => {
        ensureSpace(16);
        y += 3;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(title, margin, y);
        y += 7;
      };

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(17);
      pdf.setTextColor(15, 23, 42);
      pdf.text(isGlobal ? 'LIQUIDACION GLOBAL' : 'LIQUIDACION FINAL', margin, y);
      y += 7;
      pdf.setFontSize(10);
      pdf.setTextColor(37, 99, 235);
      pdf.text(isGlobal ? 'Todos los usuarios' : (liquidationReport.users[0]?.label || getUserLabel(userProfile)), margin, y);
      y += 5.5;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Fecha: ${liquidationDateLabel}`, margin, y);
      y += 8;

      const { totals } = liquidationReport;
      pdf.setFillColor(totals.utility >= 0 ? 236 : 254, totals.utility >= 0 ? 253 : 242, totals.utility >= 0 ? 245 : 242);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 24, 2, 2, 'F');
      const summaryItems: [string, string][] = [
        ['VENTAS', money(totals.sales)],
        ['PREMIOS', money(totals.prizes)],
        ['COMISION', money(totals.commission)],
        ['UTILIDAD', money(totals.utility)]
      ];
      const boxWidth = (pageWidth - margin * 2) / 4;
      summaryItems.forEach(([label, value], index) => {
        const centerX = margin + boxWidth * index + boxWidth / 2;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(label, centerX, y + 8, { align: 'center' });
        pdf.setFontSize(12);
        pdf.setTextColor(15, 23, 42);
        pdf.text(value, centerX, y + 16, { align: 'center' });
      });
      y += 30;

      if (isGlobal && liquidationReport.users.length > 0) {
        sectionTitle('RESUMEN POR USUARIO');
        tableHeader('USUARIO');
        liquidationReport.users.forEach(row => tableRow(row.label, row));
        tableRow('TOTAL', totals, true);
      }

      sectionTitle(isGlobal ? 'RESUMEN POR SORTEO' : 'DETALLE POR SORTEO');
      tableHeader('SORTEO');
      if (liquidationReport.draws.length === 0) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100, 116, 139);
        pdf.text('No hay ventas para esta fecha.', margin + 2, y);
        y += 7;
      }
      liquidationReport.draws.forEach(row => tableRow(`${row.name}${row.time ? ` ${row.time}` : ''}`, row));

      if (isGlobal && liquidationReport.users.length > 0) {
        sectionTitle('DETALLE POR USUARIO');
        liquidationReport.users.forEach(userRow => {
          ensureSpace(30);
          y += 2;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9.5);
          pdf.setTextColor(37, 99, 235);
          pdf.text(userRow.label, margin, y);
          y += 6;
          tableHeader('SORTEO');
          userRow.draws.forEach(row => tableRow(`${row.name}${row.time ? ` ${row.time}` : ''}`, row));
          tableRow('TOTAL USUARIO', userRow, true);
        });
      }

      const fileName = `${cleanTextForExport(`${isGlobal ? 'Liquidacion-Global' : 'Liquidacion'}-${liquidationDateLabel.replace(/ /g, '-')}`)}.pdf`;
      const result = await sharePdfDocument(pdf, fileName, isGlobal ? 'Liquidacion global' : 'Liquidacion final', `Liquidacion ${liquidationDateLabel}`);
      if (result === 'shared') {
        toast.success('Liquidación compartida', { id: toastId });
      } else if (result === 'cancelled') {
        toast.dismiss(toastId);
      } else {
        toast.info('Se descargó el PDF para compartirlo manualmente', { id: toastId });
      }
    } catch (error) {
      console.error('Error generating liquidation PDF:', error);
      toast.error('No se pudo generar la liquidación', { id: toastId });
    } finally {
      setIsSharingLiquidation(false);
    }
  };

  const handleDeleteAllSalesData = () => {
    if (!userProfile || !['ceo', 'admin', 'programador'].includes(userProfile.role)) {
      alert('No tienes permisos para ejecutar limpieza operativa');
      return;
    }

    setConfirmModal({
      show: true,
      title: 'Archivar y Limpiar Día Operativo',
      message: 'Se archivarán los datos del día operativo actual y luego se limpiarán tickets y resultados operativos. ¿Deseas continuar?',
      onConfirm: async () => {
        try {
          const result = await runOperationalArchiveAndCleanup({
            targetBusinessDay: businessDayKey,
            trigger: 'manual'
          });

          if (result.deletedCount > 0 || !result.archiveAlreadyExists) {
            toast.success('Archivo diario creado y limpieza operativa completada');
          } else {
            toast.info('El archivo diario ya exist?a y no hab?a datos pendientes por limpiar');
          }
        } catch (error) {
          console.error('Error archivando datos operativos:', error);
          toast.error('No se pudo crear el archivo diario. No se realiz? limpieza.');
        }
      }
    });
  };

  const applyLotteryToCart = (lotteryName: string) => {
    if (!lotteryName) return;
    setCart(cart.map(item => ({ ...item, lottery: lotteryName })));
    toast.success(`Lotería ${cleanText(lotteryName)} aplicada a todo el pedido`);
  };

  const downloadDataUrlFile = (dataUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    link.click();
  };

  const shareImageDataUrl = async ({
    dataUrl,
    fileName,
    title,
    text,
    dialogTitle
  }: {
    dataUrl: string;
    fileName: string;
    title: string;
    text: string;
    dialogTitle: string;
  }) => {
    let shared = false;

    if (Capacitor.isNativePlatform()) {
      try {
        const imageBase64 = dataUrl.split(',')[1];
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: imageBase64,
          directory: Directory.Cache
        });

        try {
          await Share.share({
            title,
            text,
            files: [savedFile.uri],
            dialogTitle
          });
          shared = true;
        } catch (shareWithFilesErr) {
          console.log('Native share with files failed, trying url fallback', shareWithFilesErr);
          await Share.share({
            title,
            text,
            url: savedFile.uri,
            dialogTitle
          });
          shared = true;
        }
      } catch (nativeErr) {
        console.log('Native image share unavailable', nativeErr);
      }
    }

    if (!shared && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const mimeType = blob.type || (fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
        const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const normalizedName = fileName.toLowerCase().endsWith(`.${extension}`) ? fileName : `${fileName}.${extension}`;
        const file = new File([blob], normalizedName, { type: mimeType });
        const payload = { title, text, files: [file] };

        if (!navigator.canShare || navigator.canShare(payload)) {
          await navigator.share(payload);
          shared = true;
        }
      } catch (webErr) {
        console.log('Web share with files unavailable', webErr);
      }
    }

    return shared;
  };

  const shareElementAsImage = async ({
    elementId,
    fileName,
    title,
    text,
    dialogTitle,
    backgroundColor = '#0f172a'
  }: {
    elementId: string;
    fileName: string;
    title: string;
    text: string;
    dialogTitle: string;
    backgroundColor?: string;
  }) => {
    const reportEl = document.getElementById(elementId);
    if (!reportEl) {
      toast.error('No se encontro el reporte para compartir');
      return;
    }

    const toastId = toast.loading('Generando reporte...');

    try {
      await document.fonts.ready;
      await new Promise(resolve => setTimeout(resolve, 300));

      const lib = await import('html-to-image');
      const dataUrl = await lib.toPng(reportEl, {
        backgroundColor,
        pixelRatio: 2,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left'
        }
      });

      const shared = await shareImageDataUrl({
        dataUrl,
        fileName,
        title,
        text,
        dialogTitle
      });

      if (shared) {
        toast.success('Reporte compartido', { id: toastId });
      } else {
        downloadDataUrlFile(dataUrl, fileName);
        toast.info('Tu dispositivo no permite compartir imagenes adjuntas. Se descargo para envio manual.', { id: toastId });
      }
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Error al generar el reporte', { id: toastId });
    }
  };

  const handleDownloadCierre = async () => {
    if (!cierreRef.current || !cierreLottery) return;
    const toastId = toast.loading('Generando imagen...');
    const cierreNode = cierreRef.current;
    const isAndroid = Capacitor.getPlatform() === 'android';
    const originalWidth = cierreNode.style.width;
    const originalMaxWidth = cierreNode.style.maxWidth;
    const originalMinHeight = cierreNode.style.minHeight;
    const originalMargin = cierreNode.style.margin;
    const originalBackgroundColor = cierreNode.style.backgroundColor;
    try {
      const exportWidthPx = isAndroid ? 640 : 720;
      const exportHeightPx = Math.max(900, cierreNode.scrollHeight);
      const pixelRatio = isAndroid ? 1 : 1.5;
      const imageQuality = isAndroid ? 0.82 : 0.9;
      const fileName = `Cierre-${cleanText(cierreLottery)}-${historyDate}.jpg`;

      cierreNode.style.width = `${exportWidthPx}px`;
      cierreNode.style.maxWidth = 'none';
      cierreNode.style.minHeight = `${exportHeightPx}px`;
      cierreNode.style.margin = '0 auto';
      cierreNode.style.backgroundColor = '#ffffff';

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const exportOptions = {
        backgroundColor: '#ffffff',
        cacheBust: true,
        pixelRatio,
        width: exportWidthPx,
        height: Math.max(exportHeightPx, cierreNode.scrollHeight),
        style: {
          width: `${exportWidthPx}px`,
          maxWidth: 'none',
          minHeight: `${exportHeightPx}px`,
          margin: '0 auto',
          backgroundColor: '#ffffff'
        }
      };

      const dataUrl = await htmlToImage.toJpeg(cierreNode, {
        ...exportOptions,
        quality: imageQuality
      });
      const shared = await shareImageDataUrl({
        dataUrl,
        fileName,
        title: `Cierre ${cleanText(cierreLottery)}`,
        text: `Reporte de cierre de ${cleanText(cierreLottery)} para el día ${historyDate}`,
        dialogTitle: 'Compartir Cierre'
      });

      if (shared) {
        toast.success('Cierre compartido', { id: toastId });
      } else {
        downloadDataUrlFile(dataUrl, fileName);
        toast.info('Tu dispositivo no permite compartir imágenes adjuntas. Se descargó para envío manual.', { id: toastId });
      }
    } catch (err) {
      console.error('Error generating cierre image', err);
      toast.error('Error al generar la imagen', { id: toastId });
    } finally {
      cierreNode.style.width = originalWidth;
      cierreNode.style.maxWidth = originalMaxWidth;
      cierreNode.style.minHeight = originalMinHeight;
      cierreNode.style.margin = originalMargin;
      cierreNode.style.backgroundColor = originalBackgroundColor;
    }
  };

  const openNumberTickets = (source: LotteryTicket[], lotteryName: string, type: 'CH' | 'PL' | 'BL', number: string) => {
    const rows = source.flatMap(ticket => {
      const matches = (ticket.bets || []).filter(bet => (
        bet && cleanText(bet.lottery) === cleanText(lotteryName) && getBetTypeLabel(bet.type) === type && bet.number === number
      ));
      if (matches.length === 0) return [];
      return [{
        ticket,
        amount: matches.reduce((sum, bet) => sum + (bet.amount || 0), 0),
        quantity: matches.reduce((sum, bet) => sum + (bet.quantity || 0), 0)
      }];
    }).sort((a, b) => b.amount - a.amount);
    setNumberTicketsModal({ lotteryName, type, number, rows });
  };

  const handleStatsReportExport = async (
    lotteryName: string,
    bets: Bet[],
    reportFilter: StatsReportFilter,
    formatType: 'image' | 'pdf'
  ) => {
    const includedBets = bets.filter(bet => (
      reportFilter === 'global'
      || (reportFilter === 'chance' && bet.type === 'CH')
      || (reportFilter === 'billete' && bet.type === 'BL')
      || (reportFilter === 'pale' && bet.type === 'PL')
    ));

    if (includedBets.length === 0) {
      toast.info('No hay ventas para incluir en este reporte');
      return;
    }

    const filterLabel = {
      global: 'Global',
      chance: 'Chance',
      billete: 'Billete',
      pale: 'Palé'
    }[reportFilter];
    const drawTime = lotteries.find(lottery => cleanText(lottery.name) === cleanText(lotteryName))?.drawTime;
    const totalSold = includedBets.reduce((total, bet) => total + (bet.amount || 0), 0);
    const totalFractions = includedBets
      .filter(bet => bet.type === 'CH')
      .reduce((total, bet) => total + (bet.quantity || 0), 0);
    const chanceTotals = new Map<string, number>();
    const comboTotals = new Map<string, number>();

    includedBets.forEach(bet => {
      if (bet.type === 'CH') {
        chanceTotals.set(bet.number, (chanceTotals.get(bet.number) || 0) + (bet.quantity || 0));
      } else {
        const key = `${bet.type === 'PL' ? 'Palé' : 'Billete'} ${bet.number}`;
        comboTotals.set(key, (comboTotals.get(key) || 0) + (bet.amount || 0));
      }
    });

    const chanceRows = Array.from(chanceTotals.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const paleComboRows = Array.from(comboTotals.entries())
      .filter(([combination]) => combination.startsWith('Palé '))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const billeteComboRows = Array.from(comboTotals.entries())
      .filter(([combination]) => combination.startsWith('Billete '))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const chanceGrid = Array.from({ length: 100 }, (_, index) => {
      const number = index.toString().padStart(2, '0');
      return { number, quantity: chanceTotals.get(number) || 0 };
    });
    const safeLotteryName = cleanText(lotteryName).replace(/[^a-zA-Z0-9-]+/g, '-') || 'sorteo';
    const fileName = `Reporte-${safeLotteryName}-${historyDate}.${formatType === 'image' ? 'jpg' : 'pdf'}`;
    const toastId = toast.loading(`Generando reporte ${formatType === 'image' ? 'de imagen' : 'PDF'}...`);
    let reportNode: HTMLDivElement | null = null;
    setIsGeneratingStatsReport(true);

    try {
      reportNode = document.createElement('div');
      reportNode.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;padding:36px;background:#fff;color:#111827;font-family:Arial,sans-serif;box-sizing:border-box;';

        const addHeading = (text: string, size: string, color: string, marginBottom: string) => {
          const heading = document.createElement('div');
          heading.textContent = text;
          heading.style.cssText = `font-size:${size};font-weight:800;color:${color};margin-bottom:${marginBottom};`;
          reportNode?.appendChild(heading);
        };
        const addReportRow = (label: string, value: string) => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;gap:24px;padding:7px 0;border-bottom:1px solid #e5e7eb;font-size:14px;';
          const labelNode = document.createElement('span');
          labelNode.textContent = label;
          const valueNode = document.createElement('strong');
          valueNode.textContent = value;
          row.append(labelNode, valueNode);
          reportNode?.appendChild(row);
        };
        const addReportGrid = (items: HTMLElement[], columns: number, gap: string) => {
          const grid = document.createElement('div');
          grid.style.cssText = `display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:${gap};`;
          items.forEach(item => grid.appendChild(item));
          reportNode?.appendChild(grid);
        };

        addHeading('REPORTE DE VENTAS', '24px', '#111827', '8px');
        addHeading(`${cleanText(lotteryName)}${drawTime ? ` · ${formatTime12h(drawTime)}` : ''}`, '18px', '#2563eb', '6px');
        addHeading(`Fecha: ${historyDate} · Filtro: ${filterLabel}`, '13px', '#6b7280', '20px');
        addReportRow('Total vendido', `USD ${totalSold.toFixed(2)}`);
        addReportRow('Fracciones de Chance', String(totalFractions));
        if (reportFilter === 'global' || reportFilter === 'chance') {
          addHeading('NÚMEROS Y FRACCIONES', '15px', '#111827', '8px');
          addReportGrid(chanceGrid.map(({ number, quantity }) => {
            const cell = document.createElement('div');
            cell.style.cssText = `min-height:54px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid ${quantity > 0 ? '#93c5fd' : '#e5e7eb'};border-radius:6px;background:${quantity > 0 ? '#eff6ff' : '#f9fafb'};`;
            const numberLabel = document.createElement('span');
            numberLabel.textContent = number;
            numberLabel.style.cssText = 'font-size:11px;color:#6b7280;';
            const quantityLabel = document.createElement('strong');
            quantityLabel.textContent = quantity > 0 ? String(quantity) : '-';
            quantityLabel.style.cssText = `margin-top:4px;font-size:13px;color:${quantity > 0 ? '#1d4ed8' : '#cbd5e1'};`;
            cell.append(numberLabel, quantityLabel);
            return cell;
          }), 10, '4px');
        }
        if (paleComboRows.length > 0 || billeteComboRows.length > 0) {
          addHeading('COMBINACIONES Y VENTA', '15px', '#111827', '8px');
        }
        [
          { title: 'PALÉS', rows: paleComboRows },
          { title: 'BILLETES', rows: billeteComboRows }
        ].forEach(group => {
          if (group.rows.length === 0) return;
          addHeading(group.title, '12px', '#374151', '6px');
          addReportGrid(group.rows.map(([combination, amount]) => {
            const cell = document.createElement('div');
            cell.style.cssText = 'min-height:38px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #bfdbfe;border-radius:6px;background:#eff6ff;padding:6px;white-space:nowrap;';
            const label = document.createElement('strong');
            label.textContent = combination;
            label.style.cssText = 'font-size:12px;color:#1f2937;text-align:center;';
            const total = document.createElement('span');
            total.textContent = `- $${amount.toFixed(2)}`;
            total.style.cssText = 'font-size:11px;font-weight:700;color:#1d4ed8;';
            cell.append(label, total);
            return cell;
          }), 4, '6px');
        });

        if (formatType === 'image') {
          document.body.appendChild(reportNode);
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const dataUrl = await htmlToImage.toJpeg(reportNode, {
          backgroundColor: '#ffffff',
          cacheBust: true,
          // The clone keeps the off-screen position otherwise, rendering a blank image.
          style: { position: 'static', left: '0', top: '0', margin: '0' },
          width: reportNode.offsetWidth,
          height: reportNode.offsetHeight,
          pixelRatio: Capacitor.getPlatform() === 'android' ? 1 : 1.5,
          quality: Capacitor.getPlatform() === 'android' ? 0.82 : 0.9
        });
        const shared = await shareImageDataUrl({
          dataUrl,
          fileName,
          title: `Reporte ${cleanText(lotteryName)}`,
          text: `Reporte ${filterLabel} de ${cleanText(lotteryName)} para el día ${historyDate}`,
          dialogTitle: 'Compartir reporte'
        });

        if (shared) {
          toast.success('Reporte compartido', { id: toastId });
        } else {
          downloadDataUrlFile(dataUrl, fileName);
          toast.info('Se descargó el reporte para compartirlo manualmente', { id: toastId });
        }
        return;
      }

      const pdf = createReportPdf();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;
      let y = 16;
      const ensurePdfSpace = (height: number) => {
        if (y + height > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
      };
      const addPdfSectionTitle = (text: string) => {
        ensurePdfSpace(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(31, 41, 55);
        pdf.text(text, margin, y);
        y += 7;
      };

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(17, 24, 39);
      pdf.text('REPORTE DE VENTAS', margin, y);
      y += 8;
      pdf.setFontSize(13);
      pdf.setTextColor(37, 99, 235);
      pdf.text(`${cleanText(lotteryName)}${drawTime ? ` · ${formatTime12h(drawTime)}` : ''}`, margin, y);
      y += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(107, 114, 128);
      pdf.text(`Fecha: ${historyDate} · Filtro: ${filterLabel}`, margin, y);
      y += 8;

      const summaryRowHeight = 8;
      [
        ['Total vendido', `USD ${totalSold.toFixed(2)}`],
        ['Fracciones de Chance', String(totalFractions)]
      ].forEach(([label, value]) => {
        ensurePdfSpace(summaryRowHeight);
        pdf.setDrawColor(229, 231, 235);
        pdf.line(margin, y + 2, pageWidth - margin, y + 2);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(31, 41, 55);
        pdf.text(label, margin, y);
        pdf.setFont('helvetica', 'bold');
        pdf.text(value, pageWidth - margin, y, { align: 'right' });
        y += summaryRowHeight;
      });

      if (reportFilter === 'global' || reportFilter === 'chance') {
        y += 3;
        const numberGridHeight = 10 * (10.5 + 1.2) + 2;
        ensurePdfSpace(numberGridHeight + 10);
        addPdfSectionTitle('NÚMEROS Y FRACCIONES');
        const columns = 10;
        const gap = 1.2;
        const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
        const cellHeight = 10.5;

        chanceGrid.forEach(({ number, quantity }, index) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const x = margin + column * (cellWidth + gap);
          const cellY = y + row * (cellHeight + gap);
          pdf.setDrawColor(quantity > 0 ? 147 : 229, quantity > 0 ? 197 : 231, quantity > 0 ? 253 : 235);
          pdf.setFillColor(quantity > 0 ? 239 : 249, quantity > 0 ? 246 : 250, quantity > 0 ? 255 : 251);
          pdf.roundedRect(x, cellY, cellWidth, cellHeight, 1, 1, 'FD');
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6.5);
          pdf.setTextColor(107, 114, 128);
          pdf.text(number, x + cellWidth / 2, cellY + 3.5, { align: 'center' });
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.setTextColor(quantity > 0 ? 29 : 203, quantity > 0 ? 78 : 213, quantity > 0 ? 216 : 225);
          pdf.text(quantity > 0 ? String(quantity) : '-', x + cellWidth / 2, cellY + 8, { align: 'center' });
        });
        y += 10 * (cellHeight + gap) + 2;
      }

      if (paleComboRows.length > 0 || billeteComboRows.length > 0) {
        y += 3;
        addPdfSectionTitle('COMBINACIONES Y VENTA');
        const columns = 4;
        const gapX = 2;
        const gapY = 2;
        const cellWidth = (contentWidth - gapX * (columns - 1)) / columns;
        const cellHeight = 10;

        for (const group of [
          { title: 'PALÉS', rows: paleComboRows },
          { title: 'BILLETES', rows: billeteComboRows }
        ]) {
          if (group.rows.length === 0) continue;
          addPdfSectionTitle(group.title);
          for (let start = 0; start < group.rows.length; start += columns) {
            ensurePdfSpace(cellHeight + gapY);
            group.rows.slice(start, start + columns).forEach(([combination, amount], column) => {
              const x = margin + column * (cellWidth + gapX);
              pdf.setDrawColor(191, 219, 254);
              pdf.setFillColor(239, 246, 255);
              pdf.roundedRect(x, y, cellWidth, cellHeight, 1, 1, 'FD');
              pdf.setFont('helvetica', 'bold');
              pdf.setFontSize(7);
              pdf.setTextColor(31, 41, 55);
              pdf.text(`${combination} - $${amount.toFixed(2)}`, x + cellWidth / 2, y + 6.2, { align: 'center', maxWidth: cellWidth - 3 });
            });
            y += cellHeight + gapY;
          }
        }
      }

      const pdfTitle = `Reporte ${cleanText(lotteryName)}`;
      const pdfText = `Reporte ${filterLabel} de ${cleanText(lotteryName)} para el día ${historyDate}`;
      const pdfResult = await sharePdfDocument(pdf, fileName, pdfTitle, pdfText);
      if (pdfResult === 'shared') {
        toast.success('Reporte PDF compartido', { id: toastId });
      } else if (pdfResult === 'cancelled') {
        toast.dismiss(toastId);
      } else {
        toast.info('Se descargó el PDF para compartirlo manualmente', { id: toastId });
      }
    } catch (error) {
      console.error('Error generating stats report:', error);
      toast.error('No se pudo generar el reporte', { id: toastId });
    } finally {
      reportNode?.remove();
      setIsGeneratingStatsReport(false);
    }
  };

  const todayStr = businessDayKey;

  const recentOperationalDates = useMemo(() => {
    const collected = new Set<string>([
      businessDayKey,
      getQuickOperationalDate(-1),
      getQuickOperationalDate(-2),
      getQuickOperationalDate(-3)
    ]);

    const collectTicketDate = (ticket: LotteryTicket) => collected.add(getTicketDateKey(ticket));

    tickets.forEach(collectTicketDate);
    historyTickets.forEach(collectTicketDate);
    archiveTickets.forEach(collectTicketDate);
    settlements.forEach(settlement => settlement.date && collected.add(settlement.date));
    historySettlements.forEach(settlement => settlement.date && collected.add(settlement.date));

    return Array.from(collected).sort((a, b) => b.localeCompare(a)).slice(0, 14);
  }, [
    archiveTickets,
    businessDayKey,
    getQuickOperationalDate,
    getTicketDateKey,
    historySettlements,
    historyTickets,
    settlements,
    tickets
  ]);

  const liquidacionQuickDateOptions = useMemo(() => {
    const today = getQuickOperationalDate(0);
    const yesterday = getQuickOperationalDate(-1);

    return recentOperationalDates.map(dateValue => {
      let label = dateValue;
      if (dateValue === today) label = `Hoy (${dateValue})`;
      if (dateValue === yesterday) label = `Ayer (${dateValue})`;
      return { value: dateValue, label };
    });
  }, [getQuickOperationalDate, recentOperationalDates]);
  
  // Cabecera: siempre solo los datos del usuario logueado
  const myTodayStats = useMemo(() => {
    const myEmail = user?.email?.toLowerCase();
    const myTickets = tickets.filter(t =>
      getTicketDateKey(t) === todayStr &&
      t.status !== 'cancelled' &&
      (t.sellerId === user?.uid || (!!myEmail && t.sellerEmail?.toLowerCase() === myEmail))
    );
    const summary = buildFinancialSummary({ tickets: myTickets, targetDate: todayStr });
    return {
      sales: summary.totalSales,
      commissions: summary.totalCommissions,
      prizes: summary.totalPrizes,
      netProfit: summary.netProfit
    };
  }, [buildFinancialSummary, getTicketDateKey, tickets, todayStr, user?.uid, user?.email]);

  const [dashScope, setDashScope] = useState<'global' | 'own' | 'user'>('global');
  const [dashUserEmail, setDashUserEmail] = useState('');
  const dashboardRef = useRef<HTMLDivElement>(null);

  const dashboardData = useMemo(() => {
    const myEmail = user?.email?.toLowerCase();
    const targetEmail = dashUserEmail.toLowerCase();
    const scoped = tickets.filter(t => {
      if (getTicketDateKey(t) !== todayStr || t.status === 'cancelled') return false;
      const email = t.sellerEmail?.toLowerCase();
      if (dashScope === 'own') return t.sellerId === user?.uid || (!!myEmail && email === myEmail);
      if (dashScope === 'user') return !!targetEmail && email === targetEmail;
      return true;
    });
    const summary = buildFinancialSummary({ tickets: scoped, targetDate: todayStr });

    const byUser = new Map<string, { name: string; sales: number }>();
    const byLottery = new Map<string, { name: string; sales: number }>();
    scoped.forEach(t => {
      const key = t.sellerEmail?.toLowerCase() || t.sellerId || 'sin-usuario';
      const entry = byUser.get(key) || { name: getUserLabel({ email: t.sellerEmail, name: t.sellerName }) || key, sales: 0 };
      entry.sales += t.totalAmount || 0;
      byUser.set(key, entry);
      (t.bets || []).forEach(b => {
        const lot = b.lottery || 'Sin sorteo';
        const l = byLottery.get(lot) || { name: lot, sales: 0 };
        l.sales += b.amount || 0;
        byLottery.set(lot, l);
      });
    });
    const sortDesc = (a: { sales: number }, b: { sales: number }) => b.sales - a.sales;
    return {
      sales: summary.totalSales,
      commissions: summary.totalCommissions,
      prizes: summary.totalPrizes,
      netProfit: summary.netProfit,
      ticketCount: scoped.length,
      userRanking: Array.from(byUser.values()).sort(sortDesc),
      lotteryRanking: Array.from(byLottery.values()).sort(sortDesc)
    };
  }, [buildFinancialSummary, dashScope, dashUserEmail, getTicketDateKey, tickets, todayStr, user?.uid, user?.email]);

  const shareDashboard = useCallback(async () => {
    if (!dashboardRef.current) return;
    try {
      const dataUrl = await toPng(dashboardRef.current,       {
              backgroundColor: '#0a0a0a',
              cacheBust: true,
              pixelRatio: 2,
              filter: node => !(node instanceof HTMLElement && node.dataset.noShare !== undefined)
            });
            const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `negocio-${todayStr}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '¿Cómo va el negocio?' });
      } else {
        const link = document.createElement('a');
        link.download = file.name;
        link.href = dataUrl;
        link.click();
        toast.success('Imagen descargada');
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast.error('No se pudo compartir la imagen');
    }
  }, [todayStr]);

  const groupedSettlements = useMemo(() => {
    const groups: { [email: string]: { [date: string]: Settlement[] } } = {};
    settlements.forEach(s => {
      if (!groups[s.userEmail]) groups[s.userEmail] = {};
      if (!groups[s.userEmail][s.date]) groups[s.userEmail][s.date] = [];
      groups[s.userEmail][s.date].push(s);
    });
    return groups;
  }, [settlements]);

  const filteredTickets = useMemo(() => {
    const todayStr = businessDayKey;
    const source = activeTab === 'history' 
      ? (historyDate === todayStr ? tickets : historyTickets)
      : tickets;

    return source.filter(t => {
      const ticketDate = getTicketDateKey(t);
      const matchesDate = activeTab === 'history' ? ticketDate === historyDate : true;
      const ownTicket = t.sellerId === user?.uid || t.sellerEmail?.toLowerCase() === user?.email?.toLowerCase();
      const matchesUser = activeTab === 'history'
        ? (historyViewingOtherSeller ? t.sellerEmail?.toLowerCase() === historySellerEmail : ownTicket)
        : (canAccessAllUsers || ownTicket);

      const matchesSearch = t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.bets && t.bets.some(b => b && b.number && b.number.includes(searchTerm))) ||
        (t.bets && t.bets.some(b => b && b.lottery && b.lottery.toLowerCase().includes(searchTerm.toLowerCase())));
      return matchesDate && matchesSearch && matchesUser;
    }).sort((a, b) => {
      const timeA = a.timestamp?.seconds || 0;
      const timeB = b.timestamp?.seconds || 0;
      return timeB - timeA;
    });
  }, [activeTab, businessDayKey, canAccessAllUsers, historySellerEmail, historyViewingOtherSeller, historyTickets, tickets, historyDate, searchTerm, userProfile, user?.uid, user?.email]);

  const historyTypeFilterCode = useMemo(() => {
    return historyFilter === 'CHANCE' ? 'CH' :
           historyFilter === 'BILLETE' ? 'BL' :
           historyFilter === 'PALE' ? 'PL' : undefined;
  }, [historyFilter]);

  const historyLotteryCards = useMemo(() => {
    if (activeTab !== 'history') return [];

    return sortedLotteries.map(lot => {
      const ticketsForLot = filteredTickets.filter(ticket => {
        const matchesLottery = ticket.bets && ticket.bets.some(bet => bet && cleanText(bet.lottery) === cleanText(lot.name) && (!historyTypeFilterCode || bet.type === historyTypeFilterCode));
        if (!matchesLottery) return false;
        // If viewing today's history and the toggle is off, keep excluding cancelled to preserve previous UX
        if (historyDate === businessDayKey && !enableShowAllToday) {
          return ticket.status !== 'cancelled';
        }
        return true;
      });
      if (!ticketsForLot.length) return null;

      const resultForLottery = results.find(result => result.lotteryId === lot.id && result.date === historyDate);
      const isClosedWithResult = !isLotteryOpenForSales(lot) && !!resultForLottery;
      const resultSignature = resultForLottery
        ? `${resultForLottery.firstPrize}-${resultForLottery.secondPrize}-${resultForLottery.thirdPrize}`
        : 'no-result';
      const scopeSignature = canAccessAllUsers ? `global:${historySellerEmail}` : `seller:${(user?.email || user?.uid || '').toLowerCase()}`;
      const cacheKey = `${historyDate}|${lot.id}|${historyTypeFilterCode || 'ALL'}|${scopeSignature}|${resultSignature}`;

      let cachedCard = isClosedWithResult ? closedLotteryCardsCacheRef.current.get(cacheKey) : undefined;
      if (!cachedCard) {
        const sales = ticketsForLot.reduce((acc, ticket) => {
          const lotBets = (ticket.bets || []).filter(bet => bet && cleanText(bet.lottery) === cleanText(lot.name) && (!historyTypeFilterCode || bet.type === historyTypeFilterCode));
          return acc + lotBets.reduce((sum, bet) => sum + (bet.amount || 0), 0);
        }, 0);
        const commissions = ticketsForLot.reduce((acc, ticket) => {
          const lotBets = (ticket.bets || []).filter(bet => bet && cleanText(bet.lottery) === cleanText(lot.name) && (!historyTypeFilterCode || bet.type === historyTypeFilterCode));
          const lotSales = lotBets.reduce((sum, bet) => sum + (bet.amount || 0), 0);
          return acc + (lotSales * (ticket.commissionRate || 0) / 100);
        }, 0);
        const sortedTicketsForLot = ticketsForLot
          .map(ticket => ({ t: ticket, prize: getTicketPrizes(ticket, lot.name, historyTypeFilterCode).totalPrize }))
          .sort((a, b) => b.prize - a.prize);
        const prizes = sortedTicketsForLot.reduce((sum, item) => sum + item.prize, 0);
        const netProfit = sales - commissions - prizes;

        cachedCard = { sales, commissions, prizes, netProfit, sortedTicketsForLot };
        if (isClosedWithResult) {
          closedLotteryCardsCacheRef.current.set(cacheKey, cachedCard);
        }
      }

      const currentPage = lotteryPages[lot.id] || 1;
      const itemsPerPage = 4;
      const totalPages = Math.max(1, Math.ceil(cachedCard.sortedTicketsForLot.length / itemsPerPage));
      const paginatedTickets = cachedCard.sortedTicketsForLot.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

      return {
        lot,
        ticketsForLot,
        resultForLottery,
        isClosedWithResult,
        sales: cachedCard.sales,
        prizes: cachedCard.prizes,
        netProfit: cachedCard.netProfit,
        isLoss: cachedCard.netProfit < 0,
        sortedTicketsForLot: cachedCard.sortedTicketsForLot,
        currentPage,
        totalPages,
        paginatedTickets
      };
    }).filter((item): item is NonNullable<typeof item> => !!item);
  }, [activeTab, canAccessAllUsers, canViewPaleSimulation, filteredTickets, getTicketPrizes, globalSettings.palesEnabled, globalSettings.pl13Multiplier, historyDate, historySellerEmail, historyTypeFilterCode, isLotteryOpenForSales, lotteryPages, paleSimulationSettings.enabled, paleSimulationSettings.multiplier, results, sortedLotteries, user?.email, user?.uid]);

  const historyStats = useMemo(() => {
    if (activeTab !== 'history') return null;
    
    const hTickets = filteredTickets.filter(t => {
      if (historyDate === businessDayKey && !enableShowAllToday) return t.status !== 'cancelled';
      return true;
    });
    
    const sales = hTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []);
      return acc + lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
    }, 0);

    const commissions = hTickets.reduce((acc, t) => {
      const lotBets = (t.bets || []);
      const lotSales = lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
      return acc + (lotSales * (t.commissionRate || 0) / 100);
    }, 0);

    const prizes = hTickets.reduce((acc, t) => {
      const { totalPrize } = getTicketPrizes(t);
      return acc + (totalPrize || 0);
    }, 0);

    const summary = buildFinancialSummary({
      tickets: hTickets,
      targetDate: historyDate
    });
    const bankProfit = summary.totalSales - summary.totalCommissions - summary.totalPrizes;

    return {
      sales: summary.totalSales,
      commissions: summary.totalCommissions,
      prizes: summary.totalPrizes,
      bankProfit,
      netProfit: summary.netProfit
    };
  }, [activeTab, buildFinancialSummary, filteredTickets, historyDate]);

  const fetchUserOperationalDataByDate = useCallback(async (targetDate: string, userEmail: string) => {
    const normalizedEmail = userEmail.toLowerCase().trim();
    const fetchAllUsers = normalizedEmail === allLiquidationUsersValue.toLowerCase();
    const { start, end } = getBusinessDayRange(targetDate);
    const archiveSnap = await getDoc(doc(db, 'daily_archives', targetDate));
    if (archiveSnap.exists()) {
      const archive = archiveSnap.data() as {
        tickets?: LotteryTicket[];
        settlements?: Settlement[];
        results?: LotteryResult[];
      };

      const archivedTickets = fetchAllUsers
        ? (archive.tickets || [])
        : (archive.tickets || []).filter(ticket =>
          (ticket.sellerEmail || '').toLowerCase() === normalizedEmail
        );
      const archivedSettlements = (archive.settlements || []).filter(settlement =>
        (fetchAllUsers || (settlement.userEmail || '').toLowerCase() === normalizedEmail) &&
        settlement.date === targetDate
      );

      return {
        tickets: archivedTickets,
        settlements: archivedSettlements,
        results: archive.results || []
      };
    }

    const [ticketsByEmailSnap, settlementsSnap, resultsSnap] = await Promise.all([
      getDocs(fetchAllUsers
        ? query(
          collection(db, 'tickets'),
          where('timestamp', '>=', start),
          where('timestamp', '<', end),
          limit(1500)
        )
        : query(
          collection(db, 'tickets'),
          where('sellerEmail', '==', normalizedEmail),
          where('timestamp', '>=', start),
          where('timestamp', '<', end),
          limit(1200)
        )
      ),
      getDocs(fetchAllUsers
        ? query(
          collection(db, 'settlements'),
          where('date', '==', targetDate),
          limit(1000)
        )
        : query(
          collection(db, 'settlements'),
          where('userEmail', '==', normalizedEmail),
          where('date', '==', targetDate),
          limit(300)
        )
      ),
      getDocs(query(
        collection(db, 'results'),
        where('date', '==', targetDate),
        limit(300)
      ))
    ]);

    return {
      tickets: mergeTicketSnapshots(ticketsByEmailSnap),
      settlements: settlementsSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Settlement)),
      results: resultsSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as LotteryResult))
    };
  }, [allLiquidationUsersValue, getBusinessDayRange, mergeTicketSnapshots]);

  const fetchArchiveData = useCallback(async () => {
    if (!archiveUserEmail || !archiveDate) return;
    setIsArchiveLoading(true);
    try {
      if (archiveDate === businessDayKey) {
        const currentSummary = buildFinancialSummary({
          tickets,
          settlements,
          userEmail: archiveUserEmail,
          targetDate: archiveDate
        });
        setArchiveTickets(currentSummary.tickets);
      } else {
        const archiveData = await fetchUserOperationalDataByDate(archiveDate, archiveUserEmail);
        setArchiveTickets(archiveData.tickets);
        setResults(prev => {
          const map = new Map(prev.map(item => [`${item.lotteryName}-${item.date}-${item.id}`, item]));
          archiveData.results.forEach(item => map.set(`${item.lotteryName}-${item.date}-${item.id}`, item));
          return Array.from(map.values());
        });
      }

    } catch (error) {
      console.error("Error fetching archive data:", error);
      toast.error("Error al cargar datos del archivo");
    } finally {
      setIsArchiveLoading(false);
    }
  }, [archiveUserEmail, archiveDate, buildFinancialSummary, businessDayKey, fetchUserOperationalDataByDate, settlements, tickets]);

  const parseTicketTimestampMs = useCallback((value: any) => {
    if (!value) return 0;
    if (value?.toDate) return value.toDate().getTime();
    if (value?.seconds) return value.seconds * 1000;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }, []);

  const getRecoveryTicketLotteryLabel = useCallback((ticket: RecoveryTicketRecord) => {
    const names = Array.from(new Set((ticket.bets || []).map(b => cleanText(b.lottery || '').trim()).filter(Boolean)));
    if (names.length > 0) return names.join(' | ');
    const raw = ticket.raw || {};
    return cleanText(raw.lotteryName || raw.drawName || raw.lottery || raw.draw || '-');
  }, []);

  const getRecoveryTicketLotteryNames = useCallback((ticket: RecoveryTicketRecord) => {
    const seen = new Set<string>();
    const names: string[] = [];
    (ticket.bets || []).forEach(bet => {
      const rawName = (bet?.lottery || '').trim();
      const key = normalizePlainText(rawName);
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(rawName);
    });
    return names;
  }, []);

  const parseTicketQrValue = useCallback((value: string) => {
    const cleaned = (value || '').trim();
    if (!cleaned) return { ticketId: '', ticketDate: '' };

    if (cleaned.toLowerCase().startsWith('ticket:')) {
      const [, ticketId = '', ticketDate = ''] = cleaned.split(':');
      return {
        ticketId: ticketId.trim(),
        ticketDate: ticketDate.trim()
      };
    }

    return {
      ticketId: cleaned,
      ticketDate: ''
    };
  }, []);

  const findLoadedTicketsByIdPrefix = useCallback((ticketIdPrefix: string) => {
    const normalizedPrefix = ticketIdPrefix.trim().toLowerCase();
    if (!normalizedPrefix) return [];

    const seen = new Set<string>();
    return [...tickets, ...historyTickets, ...archiveTickets].filter(ticket => {
      const matches = ticket.id.toLowerCase().startsWith(normalizedPrefix);
      if (!matches || seen.has(ticket.id)) return false;
      seen.add(ticket.id);
      return true;
    });
  }, [archiveTickets, historyTickets, tickets]);

  const handleTicketQrScan = useCallback(async (rawValue: string) => {
    const { ticketId, ticketDate } = parseTicketQrValue(rawValue);
    const ticketIdPrefix = ticketId.trim();

    if (ticketIdPrefix.length < 6) {
      toast.error('Ingresa al menos los primeros 6 caracteres del ticket');
      return;
    }

    setShowTicketScanner(false);

    const loadedMatches = findLoadedTicketsByIdPrefix(ticketIdPrefix);
    if (loadedMatches.length === 1) {
      setShowTicketModal({ ticket: loadedMatches[0] });
      toast.success('Ticket verificado');
      return;
    }
    if (loadedMatches.length > 1) {
      toast.error('Hay varios tickets con ese inicio. Ingresa mas caracteres.');
      return;
    }

    const toastId = toast.loading('Buscando ticket...');
    try {
      if (ticketIdPrefix.length >= 12) {
        const liveSnap = await getDoc(doc(db, 'tickets', ticketIdPrefix));
        if (liveSnap.exists()) {
          setShowTicketModal({ ticket: { id: liveSnap.id, ...liveSnap.data() } as LotteryTicket });
          toast.success('Ticket verificado', { id: toastId });
          return;
        }
      }

      const liveMatchesSnap = await getDocs(query(
        collection(db, 'tickets'),
        where(documentId(), '>=', ticketIdPrefix),
        where(documentId(), '<=', `${ticketIdPrefix}\uf8ff`),
        limit(2)
      ));

      if (liveMatchesSnap.size === 1) {
        const ticketDoc = liveMatchesSnap.docs[0];
        setShowTicketModal({ ticket: { id: ticketDoc.id, ...ticketDoc.data() } as LotteryTicket });
        toast.success('Ticket verificado', { id: toastId });
        return;
      }

      if (liveMatchesSnap.size > 1) {
        toast.error('Hay varios tickets con ese inicio. Ingresa mas caracteres.', { id: toastId });
        return;
      }

      if (ticketDate) {
        const archiveSnap = await getDoc(doc(db, 'daily_archives', ticketDate));
        if (archiveSnap.exists()) {
          const archiveData = archiveSnap.data() as { tickets?: LotteryTicket[] };
          const archivedMatches = (archiveData.tickets || []).filter(ticket =>
            ticket.id.toLowerCase().startsWith(ticketIdPrefix.toLowerCase())
          );
          if (archivedMatches.length === 1) {
            setShowTicketModal({ ticket: archivedMatches[0] });
            toast.success('Ticket verificado desde archivo', { id: toastId });
            return;
          }
          if (archivedMatches.length > 1) {
            toast.error('Hay varios tickets archivados con ese inicio. Ingresa mas caracteres.', { id: toastId });
            return;
          }
        }
      }

      toast.error('No se encontro el ticket original', { id: toastId });
    } catch (error: any) {
      console.error('Error verifying ticket QR:', error);
      toast.error(error?.message || 'No se pudo verificar el ticket', { id: toastId });
    }
  }, [findLoadedTicketsByIdPrefix, parseTicketQrValue]);

  const recoveryAvailableLotteries = useMemo(() => {
    return [...lotteries]
      .sort((a, b) => {
        const at = getOperationalTimeSortValue(a.drawTime || '00:00');
        const bt = getOperationalTimeSortValue(b.drawTime || '00:00');
        return at - bt;
      });
  }, [getOperationalTimeSortValue, lotteries]);

  const fetchRecoveryData = useCallback(async () => {
    if (userProfile?.role !== 'programador' || !recoveryDate) return;
    setIsRecoveryLoading(true);
    try {
      const { start, end } = getBusinessDayRange(recoveryDate);
      const [ticketsSnapshot, archiveSnapshot] = await Promise.all([
        getDocs(query(
          collection(db, 'tickets'),
          where('timestamp', '>=', start),
          where('timestamp', '<', end),
          limit(5000)
        )),
        getDoc(doc(db, 'daily_archives', recoveryDate))
      ]);

      const liveRows: RecoveryTicketRecord[] = ticketsSnapshot.docs.map(docSnap => {
        const data = docSnap.data() as Record<string, any>;
        return {
          rowId: `tickets:${docSnap.id}`,
          source: 'tickets',
          id: docSnap.id,
          sellerId: data.sellerId || '',
          sellerCode: data.sellerCode || '',
          sellerName: data.sellerName || '',
          sellerEmail: data.sellerEmail || '',
          timestamp: data.timestamp || null,
          status: data.status || '',
          totalAmount: Number(data.totalAmount || 0),
          bets: Array.isArray(data.bets) ? data.bets : [],
          raw: data
        };
      });

      const archiveRows: RecoveryTicketRecord[] = archiveSnapshot.exists()
        ? (((archiveSnapshot.data()?.tickets || []) as any[]).map((ticket: any) => ({
            rowId: `daily_archives:${recoveryDate}:${ticket.id}`,
            source: 'daily_archives' as const,
            archiveDate: recoveryDate,
            id: ticket.id,
            sellerId: ticket.sellerId || '',
            sellerCode: ticket.sellerCode || '',
            sellerName: ticket.sellerName || '',
            sellerEmail: ticket.sellerEmail || '',
            timestamp: ticket.timestamp || null,
            status: ticket.status || '',
            totalAmount: Number(ticket.totalAmount || 0),
            bets: Array.isArray(ticket.bets) ? ticket.bets : [],
            raw: ticket
          })))
        : [];

      const merged = [...liveRows, ...archiveRows].sort((a, b) => parseTicketTimestampMs(a.timestamp) - parseTicketTimestampMs(b.timestamp));
      setRecoveryTickets(merged);

      const nextSelection: Record<string, string> = {};
      const nextMultiSelection: Record<string, Record<string, string>> = {};
      merged.forEach(row => {
        const ticketLotteries = getRecoveryTicketLotteryNames(row);
        if (ticketLotteries.length <= 1) {
          const guessedLotteryName = ticketLotteries[0] || ((row.bets || [])[0]?.lottery || '').trim();
          const match = recoveryAvailableLotteries.find(l => normalizePlainText(l.name) === normalizePlainText(guessedLotteryName));
          if (match) nextSelection[row.rowId] = match.id;
          return;
        }

        const rowSelection: Record<string, string> = {};
        ticketLotteries.forEach(sourceLottery => {
          const match = recoveryAvailableLotteries.find(l => normalizePlainText(l.name) === normalizePlainText(sourceLottery));
          if (match) rowSelection[sourceLottery] = match.id;
        });
        nextMultiSelection[row.rowId] = rowSelection;
      });
      setRecoveryTargetLotteryByRow(nextSelection);
      setRecoveryTargetLotteryMapByRow(nextMultiSelection);
    } catch (error) {
      console.error('Error fetching recovery data:', error);
      toast.error('No se pudieron cargar tickets para recuperación');
    } finally {
      setIsRecoveryLoading(false);
    }
  }, [getBusinessDayRange, getRecoveryTicketLotteryNames, parseTicketTimestampMs, recoveryAvailableLotteries, recoveryDate, userProfile?.role]);

  const filteredRecoveryTickets = useMemo(() => {
    const sellerFilter = recoverySellerFilter.trim().toLowerCase();
    const lotteryFilter = recoveryLotteryFilter.trim().toLowerCase();
    const ticketIdFilter = recoveryTicketIdFilter.trim().toLowerCase();

    const filtered = recoveryTickets.filter(ticket => {
      const sellerText = `${ticket.sellerName || ''} ${ticket.sellerId || ''} ${ticket.sellerCode || ''} ${ticket.sellerEmail || ''}`.toLowerCase();
      const lotteryText = getRecoveryTicketLotteryLabel(ticket).toLowerCase();
      const ticketIdText = (ticket.id || '').toLowerCase();
      const statusText = (ticket.status || '').toLowerCase();

      if (sellerFilter && !sellerText.includes(sellerFilter)) return false;
      if (lotteryFilter && !lotteryText.includes(lotteryFilter)) return false;
      if (ticketIdFilter && !ticketIdText.includes(ticketIdFilter)) return false;
      if (recoveryStatusFilter !== 'ALL' && statusText !== recoveryStatusFilter) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      const diff = parseTicketTimestampMs(a.timestamp) - parseTicketTimestampMs(b.timestamp);
      return recoverySortOrder === 'asc' ? diff : -diff;
    });
  }, [
    getRecoveryTicketLotteryLabel,
    parseTicketTimestampMs,
    recoveryLotteryFilter,
    recoverySellerFilter,
    recoverySortOrder,
    recoveryStatusFilter,
    recoveryTicketIdFilter,
    recoveryTickets
  ]);

  // When exportRecoveryList is set, render hidden receipts and produce a multi-page PDF
  useEffect(() => {
    if (!exportRecoveryList || !exportRecoveryList.length) return;
    let cancelled = false;
    (async () => {
      setIsExportingRecovery(true);
      try {
        await document.fonts.ready;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 200));

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pxToMm = (px: number) => (px * 0.2645833333);

        for (let i = 0; i < exportRecoveryList.length; i++) {
          if (cancelled) break;
          const ticket = exportRecoveryList[i];
          const node = exportRefsRef.current[ticket.rowId];
          if (!node) continue;
          try {
            const dataUrl = await toPng(node, { width: node.scrollWidth, height: node.scrollHeight, pixelRatio: 2, backgroundColor: '#ffffff' });
            if (!dataUrl) continue;
            if (i > 0) doc.addPage();
            const imgProps = doc.getImageProperties(dataUrl);
            const pdfW = doc.internal.pageSize.getWidth();
            const pdfH = (imgProps.height * pdfW) / imgProps.width;
            doc.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH);
          } catch (err) {
            console.error('Error exporting ticket image', err);
          }
        }
        const fileName = `recuperacion-tickets-${Date.now()}.pdf`;
        doc.save(fileName);
        toast.success('Exportación completa');
      } catch (err) {
        console.error('Error en exportación masiva:', err);
        toast.error('Error al exportar tickets');
      } finally {
        setIsExportingRecovery(false);
        setExportRecoveryList(null);
        exportRefsRef.current = {};
      }
    })();
    return () => { cancelled = true; };
  }, [exportRecoveryList]);

  const saveRecoveryLotteryChange = useCallback(async (ticket: RecoveryTicketRecord) => {
    if (userProfile?.role !== 'programador') {
      toast.error('Acceso restringido a rol programador');
      return;
    }

    const ticketLotteries = getRecoveryTicketLotteryNames(ticket);
    const isMultipleTicket = ticketLotteries.length > 1;

    const targetBySource = new Map<string, Lottery>();
    if (isMultipleTicket) {
      const selectedMap = recoveryTargetLotteryMapByRow[ticket.rowId] || {};
      for (const sourceLottery of ticketLotteries) {
        const selectedLotteryId = selectedMap[sourceLottery];
        if (!selectedLotteryId) {
          toast.error('Debes seleccionar destino para cada sorteo del ticket multiple');
          return;
        }
        const selectedLottery = recoveryAvailableLotteries.find(l => l.id === selectedLotteryId);
        if (!selectedLottery) {
          toast.error(`Sorteo destino invalido para ${sourceLottery}`);
          return;
        }
        targetBySource.set(sourceLottery, selectedLottery);
      }
    } else {
      const targetLotteryId = recoveryTargetLotteryByRow[ticket.rowId];
      if (!targetLotteryId) {
        toast.error('Selecciona un sorteo destino');
        return;
      }
      const targetLottery = recoveryAvailableLotteries.find(l => l.id === targetLotteryId);
      if (!targetLottery) {
        toast.error('El sorteo destino no existe');
        return;
      }
      const sourceLottery = ticketLotteries[0] || ((ticket.bets || [])[0]?.lottery || '').trim();
      targetBySource.set(sourceLottery, targetLottery);
    }

    setRecoverySavingRowId(ticket.rowId);
    try {
      const targetBySourceKey = new Map<string, Lottery>();
      targetBySource.forEach((targetLottery, sourceLottery) => {
        targetBySourceKey.set(normalizePlainText(sourceLottery), targetLottery);
      });

      const updatedBets = (ticket.bets || []).map(bet => {
        const sourceLotteryKey = normalizePlainText(bet.lottery || '');
        const mappedLottery = targetBySourceKey.get(sourceLotteryKey);
        if (!mappedLottery) return bet;
        return { ...bet, lottery: mappedLottery.name };
      });

      const uniqueTargetIds = Array.from(new Set(Array.from(targetBySource.values()).map(lottery => lottery.id)));
      const singleTargetLottery = uniqueTargetIds.length === 1
        ? recoveryAvailableLotteries.find(l => l.id === uniqueTargetIds[0]) || null
        : null;

      const optionalFields: Record<string, any> = {};
      const textFields = ['lotteryName', 'drawName', 'lottery', 'draw', 'selectedLottery', 'lotteryLabel', 'drawLabel'];
      const idFields = ['lotteryId', 'drawId', 'selectedLotteryId'];
      const timeFields = ['lotteryTime', 'drawTime'];

      if (singleTargetLottery) {
        textFields.forEach(field => {
          if (Object.prototype.hasOwnProperty.call(ticket.raw, field)) optionalFields[field] = singleTargetLottery.name;
        });
        idFields.forEach(field => {
          if (Object.prototype.hasOwnProperty.call(ticket.raw, field)) optionalFields[field] = singleTargetLottery.id;
        });
        timeFields.forEach(field => {
          if (Object.prototype.hasOwnProperty.call(ticket.raw, field)) optionalFields[field] = singleTargetLottery.drawTime || '';
        });
      }

      const updatePayload = {
        bets: updatedBets,
        ...optionalFields,
        recoveryUpdatedAt: serverTimestamp(),
        recoveryUpdatedBy: userProfile.email || ''
      };

      if (ticket.source === 'tickets') {
        await updateDoc(doc(db, 'tickets', ticket.id), updatePayload);
      } else {
        if (!ticket.archiveDate) throw new Error('archiveDate requerido para editar ticket archivado');
        const archiveRef = doc(db, 'daily_archives', ticket.archiveDate);
        const archiveSnap = await getDoc(archiveRef);
        if (!archiveSnap.exists()) throw new Error('Archivo diario no encontrado');
        const archiveData = archiveSnap.data() as Record<string, any>;
        const archiveTickets: any[] = Array.isArray(archiveData.tickets) ? archiveData.tickets : [];
        const archiveTicketPayload = {
          bets: updatedBets,
          ...optionalFields,
          recoveryUpdatedAt: new Date().toISOString(),
          recoveryUpdatedBy: userProfile.email || ''
        };
        const nextArchiveTickets = archiveTickets.map(archiveTicket =>
          archiveTicket.id === ticket.id
            ? { ...archiveTicket, ...archiveTicketPayload }
            : archiveTicket
        );
        await updateDoc(archiveRef, {
          tickets: nextArchiveTickets,
          recoveryUpdatedAt: serverTimestamp(),
          recoveryUpdatedBy: userProfile.email || ''
        });
      }

      setRecoveryTickets(prev => prev.map(item => (
        item.rowId === ticket.rowId
          ? {
              ...item,
              bets: updatedBets,
              raw: { ...item.raw, ...optionalFields, bets: updatedBets }
            }
          : item
      )));

      const applyTicketUpdate = (row: LotteryTicket): LotteryTicket => (
        row.id === ticket.id
          ? { ...row, bets: updatedBets, ...optionalFields }
          : row
      );
      setTickets(prev => prev.map(applyTicketUpdate));
      setHistoryTickets(prev => prev.map(applyTicketUpdate));
      setArchiveTickets(prev => prev.map(applyTicketUpdate));
      setLiquidationTicketsSnapshot(prev => prev.map(applyTicketUpdate));

      historyDataCacheRef.current.clear();liquidationDayCacheRef.current.clear();
      closedLotteryCardsCacheRef.current.clear();
      await fetchRecoveryData();

      if (singleTargetLottery) {
        toast.success(`Ticket ${ticket.id.slice(0, 8)} movido a ${cleanText(singleTargetLottery.name)}`);
      } else {
        toast.success(`Ticket ${ticket.id.slice(0, 8)} actualizado (multi-sorteo) y sistema recalculado`);
      }
    } catch (error) {
      console.error('Error updating recovery ticket:', error);
      toast.error('No se pudo guardar el cambio de sorteo');
    } finally {
      setRecoverySavingRowId(null);
    }
  }, [fetchRecoveryData, getRecoveryTicketLotteryNames, recoveryAvailableLotteries, recoveryTargetLotteryByRow, recoveryTargetLotteryMapByRow, userProfile?.email, userProfile?.role]);

  const deleteRecoveryTicket = useCallback((ticket: RecoveryTicketRecord) => {
    if (userProfile?.role !== 'programador') {
      toast.error('Acceso restringido a rol programador');
      return;
    }

    setConfirmModal({
      show: true,
      title: 'Eliminar Ticket',
      message: `Se eliminará el ticket ${ticket.id.slice(0, 8)} de ${ticket.source === 'tickets' ? 'LIVE' : `ARCHIVO ${ticket.archiveDate}`}. ¿Deseas continuar?`,
      onConfirm: async () => {
        setRecoveryDeletingRowId(ticket.rowId);
        try {
          if (ticket.source === 'tickets') {
            await deleteDoc(doc(db, 'tickets', ticket.id));
          } else {
            if (!ticket.archiveDate) throw new Error('archiveDate requerido para eliminar ticket archivado');
            const archiveRef = doc(db, 'daily_archives', ticket.archiveDate);
            const archiveSnap = await getDoc(archiveRef);
            if (!archiveSnap.exists()) throw new Error('Archivo diario no encontrado');

            const archiveData = archiveSnap.data() as Record<string, any>;
            const archiveTickets: any[] = Array.isArray(archiveData.tickets) ? archiveData.tickets : [];
            const nextArchiveTickets = archiveTickets.filter(archiveTicket => archiveTicket.id !== ticket.id);

            await updateDoc(archiveRef, {
              tickets: nextArchiveTickets,
              recoveryUpdatedAt: serverTimestamp(),
              recoveryUpdatedBy: userProfile.email || ''
            });
          }

          setRecoveryTickets(prev => prev.filter(item => item.rowId !== ticket.rowId));
          setRecoveryTargetLotteryByRow(prev => {
            const next = { ...prev };
            delete next[ticket.rowId];
            return next;
          });
          setRecoveryTargetLotteryMapByRow(prev => {
            const next = { ...prev };
            delete next[ticket.rowId];
            return next;
          });

          if (ticket.source === 'tickets') {
            setTickets(prev => prev.filter(item => item.id !== ticket.id));
            setHistoryTickets(prev => prev.filter(item => item.id !== ticket.id));
            setLiquidationTicketsSnapshot(prev => prev.filter(item => item.id !== ticket.id));
          } else {
            setArchiveTickets(prev => prev.filter(item => item.id !== ticket.id));
          }

          historyDataCacheRef.current.clear();liquidationDayCacheRef.current.clear();
          closedLotteryCardsCacheRef.current.clear();
          await fetchRecoveryData();

          toast.success(`Ticket ${ticket.id.slice(0, 8)} eliminado correctamente`);
        } catch (error) {
          console.error('Error deleting recovery ticket:', error);
          toast.error('No se pudo eliminar el ticket');
        } finally {
          setRecoveryDeletingRowId(null);
        }
      }
    });
  }, [fetchRecoveryData, userProfile?.email, userProfile?.role]);

  useEffect(() => {
    if (activeTab !== 'recovery' || userProfile?.role !== 'programador') return;
    fetchRecoveryData();
  }, [activeTab, fetchRecoveryData, userProfile?.role]);

  useEffect(() => {
    if (activeTab !== 'liquidaciones' || !liquidationDate) {
      setLiquidationTicketsSnapshot([]);
      setLiquidationResultsSnapshot([]);
      return;
    }

    const lastDay = liquidationEndDate && liquidationEndDate > liquidationDate ? liquidationEndDate : liquidationDate;
    const pastDays: string[] = [];
    const cursor = new Date(`${liquidationDate}T12:00:00`);
    while (pastDays.length < 31) {
      const dayKey = format(cursor, 'yyyy-MM-dd');
      if (dayKey > lastDay) break;
      if (dayKey < businessDayKey) pastDays.push(dayKey);
      cursor.setDate(cursor.getDate() + 1);
    }

    if (pastDays.length === 0) {
      setLiquidationTicketsSnapshot([]);
      setLiquidationResultsSnapshot([]);
      return;
    }

    const scopeEmail = canChooseLiquidationUser
      ? allLiquidationUsersValue
      : (userProfile?.email || '').toLowerCase();
    let cancelled = false;
    setIsLiquidationDataLoading(true);

    (async () => {
      const collectedTickets: LotteryTicket[] = [];
      const collectedResults: LotteryResult[] = [];
      for (const day of pastDays) {
        const cacheKey = `${day}|${scopeEmail}`;
        let dayData = liquidationDayCacheRef.current.get(cacheKey);
        if (!dayData) {
          const fetched = await fetchUserOperationalDataByDate(day, scopeEmail);
          dayData = { tickets: fetched.tickets, results: fetched.results };
          // Solo se guardan días que ya tienen resultados para no congelar datos incompletos.
          if (fetched.results.length > 0) liquidationDayCacheRef.current.set(cacheKey, dayData);
        }
        collectedTickets.push(...dayData.tickets);
        collectedResults.push(...dayData.results);
      }
      if (cancelled) return;
      setLiquidationTicketsSnapshot(collectedTickets);
      setLiquidationResultsSnapshot(collectedResults);
    })()
      .catch(error => {
        if (cancelled) return;
        console.error('Error loading liquidation source data:', error);
        toast.error('No se pudieron cargar los datos históricos de la liquidación');
      })
      .finally(() => {
        if (!cancelled) setIsLiquidationDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, allLiquidationUsersValue, businessDayKey, canChooseLiquidationUser, fetchUserOperationalDataByDate, liquidationDate, liquidationEndDate, userProfile?.email]);

  const userStats = useMemo(() => {
    const stats: Record<string, { sales: number, commissions: number, prizes: number, utility: number }> = {};
    
    // Initialize stats for all users
    users.forEach(u => {
      if (u.email) {
        stats[u.email.toLowerCase()] = { sales: 0, commissions: 0, prizes: 0, utility: 0 };
      }
    });

    // Calculate from tickets
    const sourceTickets = activeTab === 'history' ? historyTickets : tickets;
    
    sourceTickets.forEach(t => {
      if (t.status === 'cancelled') return;
      const email = t.sellerEmail?.toLowerCase();
      if (email && stats[email]) {
        const lotBets = (t.bets || []);
        const lotSales = lotBets.reduce((sum, b) => sum + (b.amount || 0), 0);
        stats[email].sales += lotSales;
        stats[email].commissions += (lotSales * (t.commissionRate || 0) / 100);
        const { totalPrize } = getTicketPrizes(t);
        stats[email].prizes += (totalPrize || 0);
      }
    });

    // Final utility calculation: sales - commissions - prizes
    Object.keys(stats).forEach(email => {
      const s = stats[email];
      s.utility = s.sales - s.commissions - s.prizes;
    });

    return stats;
  }, [activeTab, users, tickets, historyTickets, getTicketPrizes]);

  const isConfigAdmin = userProfile?.role === 'ceo' || userProfile?.role === 'programador';
  const configTabsList: { id: string; label: string; visible: boolean }[] = [
    { id: 'sorteos', label: 'Sorteos', visible: isConfigAdmin },
    { id: 'usuarios', label: 'Usuarios', visible: isConfigAdmin || !!userProfile?.canLiquidate },
    { id: 'chances', label: 'Chances', visible: userProfile?.role !== 'seller' },
    { id: 'especiales', label: 'Especiales', visible: isConfigAdmin },
    { id: 'dispositivos', label: 'Dispositivos', visible: true },
    { id: 'perfil', label: 'Mi Perfil', visible: true },
  ];
  const currentConfigTab = activeTab === 'admin' ? 'sorteos' : activeTab === 'users' ? 'usuarios' : configSection;
  const configTabsBar = (
    <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white/5 p-1 no-scrollbar">
      {configTabsList.filter(t => t.visible).map(t => (
        <button
          key={t.id}
          onClick={() => {
            if (t.id === 'sorteos') setActiveTab('admin');
            else if (t.id === 'usuarios') setActiveTab('users');
            else {
              setConfigSection(t.id as typeof configSection);
              setActiveTab('config');
            }
          }}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all ${
            currentConfigTab === t.id ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div style={{ position: 'fixed', left: -10000, top: 0, width: 360, height: 10000, overflow: 'hidden' }} aria-hidden>
        {exportRecoveryList?.map(ticket => (
          <div key={ticket.rowId} ref={(el) => { exportRefsRef.current[ticket.rowId] = el; }}>
            <TicketReceiptExport ticket={ticket} localTotalAmount={Number(ticket.totalAmount || 0)} />
          </div>
        ))}
      </div>
      <Toaster position="top-right" richColors duration={2000} />
      {loading || (user && userProfile === undefined) ? (
        <div key="loading" className="min-h-screen bg-background flex items-center justify-center font-mono">
          <span>CARGANDO SISTEMA...</span>
        </div>
      ) : !user ? (
        <Login key="login" />
      ) : !userProfile ? (
        <div key="access-denied" className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
          <div className="glass-card p-8 max-w-md w-full text-center space-y-6">
            <ShieldCheck className="w-16 h-16 text-destructive mx-auto" />
            <h1 className="text-2xl font-black italic tracking-tighter">
              <span>ACCESO DENEGADO</span>
            </h1>
            <p className="text-muted-foreground font-mono text-sm">
              <span>Tu cuenta ({user?.email}) no tiene permisos asignados en el sistema. Contacta al administrador.</span>
            </p>
            <button 
              onClick={handleLogout}
              className="w-full bg-white/10 text-white py-3 rounded-xl font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" /> Cerrar Sesión
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-screen bg-background text-foreground font-sans flex flex-col lg:flex-row overflow-hidden">
          <FastEntryModal
        show={showFastEntryModal}
        onAdd={(bets) => {
          const accepted: Bet[] = [];
          bets.forEach(b => {
            const working = [...cart, ...accepted];
            if (b.type === 'PL' && (!globalSettings.palesEnabled || !lotteryAllowsPale(findActiveLotteryByName(b.lottery)))) return;
            if (b.type === 'BL') {
              if (!globalSettings.billetesEnabled) return;
              if (!lotteryAllowsBillete(findActiveLotteryByName(b.lottery)) || !isBilleteOpenForSales(findActiveLotteryByName(b.lottery))) return;
              if (!validateComboUnitCost('BL', b.amount)) return;
            }
            if ((b.type === 'PL' || b.type === 'BL') && exceedsComboLimit(b.type, b.number, b.lottery, b.amount, working)) return;
            accepted.push(b);
          });
          if (accepted.length === 0) return;
          setCart(prevCart => unifyBets([...prevCart, ...accepted]));
          toast.success('Apuestas agregadas y unificadas');
        }}
        onClose={() => setShowFastEntryModal(false)}
        selectedLotteries={isMultipleMode ? multiLottery : (selectedLottery ? [selectedLottery] : [])}
        chancePrice={chancePrice}
        plAmount={plAmount}
        comboType={betType === 'BL' ? 'BL' : 'PL'}
      />

      {numberTicketsModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setNumberTicketsModal(null)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-[#1A1F30] to-[#0B1220] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 px-2 text-primary">
                  <span className="text-lg font-black">{numberTicketsModal.type === 'CH' ? numberTicketsModal.number : `${numberTicketsModal.type} ${numberTicketsModal.number}`}</span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold leading-tight text-white">Detalle de Ventas</h2>
                  <p className="truncate text-xs text-slate-400">{cleanText(numberTicketsModal.lotteryName)} · {numberTicketsModal.rows.length} ticket(s)</p>
                </div>
              </div>
              <button onClick={() => setNumberTicketsModal(null)} className="rounded-full p-2 transition-colors hover:bg-white/10">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {numberTicketsModal.rows.length > 0 ? numberTicketsModal.rows.map(({ ticket, amount, quantity }) => {
                const ticketDate = ticket.timestamp?.toDate ? ticket.timestamp.toDate() : new Date(ticket.timestamp);
                return (
                  <button
                    type="button"
                    key={ticket.id}
                    onClick={() => setShowTicketModal({ ticket, selectedLotteryName: numberTicketsModal.lotteryName })}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-200">{ticket.customerName?.trim() || 'Cliente general'}</p>
                      <p className="truncate text-[10px] font-mono text-slate-400">
                        {isNaN(ticketDate.getTime()) ? '--:--' : format(ticketDate, 'hh:mm a')} · {ticket.sellerName || ticket.sellerEmail}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">${amount.toFixed(2)}</p>
                        {numberTicketsModal.type === 'CH' && <p className="text-xs font-black text-primary">x{quantity}</p>}
                      </div>
                      <Receipt className="h-5 w-5 text-slate-300" />
                    </div>
                  </button>
                );
              }) : (
                <p className="py-10 text-center text-sm text-slate-400">No se encontraron tickets.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showTicketModal && (
        <TicketModal 
          ticket={showTicketModal.ticket} 
          selectedLotteryName={showTicketModal.selectedLotteryName}
          results={results} 
          lotteries={lotteries}
          globalSettings={globalSettings}
          users={users}
          canViewPaleSimulation={canViewPaleSimulation}
          paleSimulationSettings={paleSimulationSettings}
          onClose={() => setShowTicketModal(null)} 
        />
      )}

      <TicketQrScannerModal
        show={showTicketScanner}
        onClose={() => setShowTicketScanner(false)}
        onScan={handleTicketQrScan}
      />

      <ConfirmationModal 
        show={confirmModal.show}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal(prev => ({ ...prev, show: false }))}
      />

      <LotterySelectorModal 
        show={reuseModal.show}
        lotteries={activeLotteries}
        onSelect={handleReuseSelect}
        onClose={() => setReuseModal({ show: false, ticket: null })}
      />

      <CheckoutModal 
        show={showCheckoutModal}
        customerName={customerName}
        setCustomerName={setCustomerName}
        onConfirm={confirmSale}
        onClose={() => setShowCheckoutModal(false)}
        isSubmitting={isSubmittingSale}
      />

      <LotteryModal 
        show={showLotteryModal}
        lottery={editingLottery}
        onSave={saveLottery}
        onClose={() => { setShowLotteryModal(false); setEditingLottery(null); }}
        globalSettings={globalSettings}
      />

      <UserModal
        show={showUserModal}
        userProfile={editingUser}
        onSave={saveUser}
        onClose={() => { setShowUserModal(false); setEditingUser(null); }}
        currentUserRole={userProfile?.role}
        canCreateProgramador={isPrimaryCeoUser}
      />

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isMobile && isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60             backdrop-blur-sm z-[55]"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isMobile ? (isSidebarOpen ? 280 : 0) : (isSidebarOpen ? 280 : 80),
          x: isMobile && !isSidebarOpen ? -280 : 0
        }}
        className={`glass border-r border-border h-screen flex flex-col ${isMobile ? 'z-[60] fixed inset-y-0 left-0' : 'z-30 relative'}`}
      >
        <div className="p-6 flex items-center gap-3">
          <div className="bg-primary p-2 rounded-lg neon-border">
            <TicketIcon className="w-6 h-6 text-primary-foreground" />
          </div>
          {isSidebarOpen && (
            <motion.h1 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xl font-black italic tracking-tighter neon-text"
            >
              CHANCE PRO
            </motion.h1>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, role: ['ceo', 'admin', 'programador'] },
            { id: 'sales', label: 'Nueva Venta', icon: Plus },
            { id: 'history', label: 'Resumen de ventas', icon: History },
            { id: 'stats', label: 'Reportes', icon: BarChart3, role: ['ceo', 'admin', 'seller', 'programador'] },
            { id: 'cierres', label: 'Cierres', icon: Printer, role: ['ceo', 'admin', 'seller', 'programador'] },
            { id: 'results', label: 'Resultados', icon: CheckCircle2, role: ['ceo', 'admin', 'seller', 'programador'] },
            { id: 'archivo', label: 'Archivo', icon: Archive, role: ['ceo', 'admin', 'programador'] },
            { id: 'liquidaciones', label: 'Liquidaciones', icon: DollarSign, role: ['ceo', 'admin', 'seller', 'programador'], permission: 'canLiquidate' },
            { id: 'recovery', label: 'Recuperación', icon: Database, role: ['programador'] },
            { id: 'config', label: 'Configuración', icon: Settings, role: ['ceo', 'admin', 'seller', 'programador'] }
          ].filter(item => {
            if (isMobile && ['sales', 'history', 'stats', 'results'].includes(item.id)) return false;
            if (!item.role) return true;
            if (item.permission === 'canLiquidate') {
              if (userProfile?.role === 'ceo' || userProfile?.role === 'seller' || userProfile?.role === 'programador') return true;
              return userProfile?.canLiquidate;
            }
            if (item.id === 'users' && item.role.includes('canLiquidate')) {
              return userProfile?.role === 'ceo' || userProfile?.role === 'programador' || userProfile?.canLiquidate;
            }
            return item.role.includes(userProfile?.role || '');
          }).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'config') {
                  if (isConfigAdmin) setActiveTab('admin');
                  else { setConfigSection('perfil'); setActiveTab('config'); }
                } else {
                  setActiveTab(item.id as any);
                }
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                (activeTab === item.id || (item.id === 'config' && (activeTab === 'users' || activeTab === 'admin')))
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' 
                  : 'hover:bg-white/5 text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {isSidebarOpen && <span className="text-sm font-bold uppercase tracking-wider">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-border space-y-2">
          <div className={`flex items-center gap-3 px-4 py-2 rounded-xl transition-all ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
            {isOnline ? <Cloud className="w-5 h-5 flex-shrink-0" /> : <CloudOff className="w-5 h-5 flex-shrink-0" />}
            {isSidebarOpen && (
              <div className="flex flex-col">
                <span className="text-[11px] font-black uppercase tracking-widest leading-none">
                  {isOnline ? 'Sincronizado' : 'Sin Conexión'}
                </span>
                <span className="text-[11px] font-mono font-bold opacity-80 uppercase">
                  {isOnline ? 'Nube Activa' : 'Modo Local'}
                </span>
              </div>
            )}
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {isSidebarOpen && <span className="text-sm font-bold uppercase tracking-wider">Cerrar Sesión</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative min-w-0">
        {/* Top Header */}
        <header className="app-header sticky top-0 z-40 h-16 glass border-b border-border px-3 flex items-center justify-between shrink-0 gap-2">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-white/5 rounded-lg text-muted-foreground shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          <div className="flex-1 flex items-center justify-around md:justify-center md:gap-12">
            <div className="flex flex-col items-center">
              <span className="text-[11px] uppercase font-extrabold text-white/70 tracking-wider">Ventas</span>
              <span className="text-xs font-black text-white">${myTodayStats.sales.toFixed(2)}</span>
            </div>
            <div className="w-px h-6 bg-white/10 hidden sm:block"></div>
            <div className="flex flex-col items-center">
              <span className="text-[11px] uppercase font-extrabold text-white/70 tracking-wider">Comisión</span>
              <span className="text-xs font-black text-primary">${myTodayStats.commissions.toFixed(2)}</span>
            </div>
            <div className="w-px h-6 bg-white/10 hidden sm:block"></div>
            <div className="flex flex-col items-center">
              <span className="text-[11px] uppercase font-extrabold text-white/70 tracking-wider">Premios</span>
              <span className="text-xs font-black text-red-400">${myTodayStats.prizes.toFixed(2)}</span>
            </div>
            <div className="w-px h-6 bg-white/10 hidden sm:block"></div>
            <div className="flex flex-col items-center">
              <span className="text-[11px] uppercase font-extrabold text-white/70 tracking-wider">Balance</span>
              <span className={`text-xs font-black ${myTodayStats.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${myTodayStats.netProfit.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-red-500/10 rounded-lg text-red-400"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Area */}
        <main className="app-main flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 md:p-8 md:pb-8 custom-scrollbar min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && userProfile?.role !== 'seller' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div ref={dashboardRef} className="space-y-3 bg-background p-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-black tracking-tight text-white">¿Cómo va el negocio?</h2>
                      <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em]">
                        {todayStr} · Corte {format(new Date(), 'hh:mm a')}
                      </p>
                    </div>
                    <button
                      onClick={shareDashboard}
                      data-no-share
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04]                       text-xs font-extrabold uppercase tracking-wider text-primary"
                    >
                      <Share2 className="w-3.5 h-3.5" /> Compartir
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1 p-1 rounded-xl border border-white/5 bg-white/[0.02]">
                    {([['global', 'Global'], ['own', 'Propio'], ['user', 'Individual']] as const).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setDashScope(id)}
                        className={`py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-colors ${dashScope === id ? 'bg-primary text-primary-foreground' : 'text-white/70'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {dashScope === 'user' && (
                    <select
                      value={dashUserEmail}
                      onChange={e => setDashUserEmail(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-background px-3 py-2.5 text-sm text-white"
                    >
                      <option value="">Elegir usuario</option>
                      {users.filter(u => u.role !== 'programador' || userProfile?.role === 'programador').map(u => (
                        <option key={u.email} value={u.email}>{getUserLabel(u)}</option>
                      ))}
                    </select>
                  )}

                  <div className="glass-card p-5 border-white/5 bg-white/[0.02] flex flex-col items-center justify-center text-center">
                    <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em] mb-1.5 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" /> Utilidad de hoy
                    </p>
                    <p className={`text-4xl font-black tabular-nums tracking-tight ${dashboardData.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {dashboardData.netProfit < 0 ? '-' : ''}${Math.abs(dashboardData.netProfit).toFixed(2)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="glass-card p-4 border-white/5 bg-white/[0.02] flex flex-col items-center justify-center text-center">
                      <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em] mb-1.5">Ventas del día</p>
                      <p className="text-2xl font-black tabular-nums tracking-tight text-white">${dashboardData.sales.toFixed(2)}</p>
                    </div>
                    <div className="glass-card p-4 border-white/5 bg-white/[0.02] flex flex-col items-center justify-center text-center">
                      <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em] mb-1.5">Comisiones</p>
                      <p className="text-2xl font-black tabular-nums tracking-tight text-primary">${dashboardData.commissions.toFixed(2)}</p>
                    </div>
                    <div className="glass-card p-4 border-white/5 bg-white/[0.02] flex flex-col items-center justify-center text-center">
                      <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em] mb-1.5">Premios pagados</p>
                      <p className="text-2xl font-black tabular-nums tracking-tight text-yellow-400">${dashboardData.prizes.toFixed(2)}</p>
                    </div>
                    <div className="glass-card p-4 border-white/5 bg-white/[0.02] flex flex-col items-center justify-center text-center">
                      <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em] mb-1.5">Tickets</p>
                      <p className="text-2xl font-black tabular-nums tracking-tight text-white">{dashboardData.ticketCount}</p>
                    </div>
                  </div>

                  <div className="glass-card p-3 border-white/5 bg-white/[0.02] text-center text-xs font-extrabold uppercase tracking-wider text-white/70">
                    {dashboardData.userRanking.length} {dashboardData.userRanking.length === 1 ? 'usuario ha vendido' : 'usuarios han vendido'} hoy
                  </div>
                </div>

                <div className="space-y-3 p-1">
                {([['Ventas por usuario', dashboardData.userRanking], ['Ventas por sorteo', dashboardData.lotteryRanking]] as const).map(([title, rows]) => (
                    <div key={title} className="glass-card p-4 border-white/5 bg-white/[0.02]">
                      <p className="text-xs font-extrabold text-white/70 uppercase tracking-[0.12em] mb-3 text-center">{title}</p>
                      {rows.length === 0 ? (
                        <p className="text-center text-xs text-muted-foreground">Sin ventas</p>
                      ) : (
                        <div className="space-y-1.5">
                          {rows.map((r, i) => (
                            <div key={`${r.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="w-5 text-[11px] font-black text-muted-foreground tabular-nums">{i + 1}</span>
                                <span className="truncate font-semibold text-white">{r.name}</span>
                              </span>
                              <span className="font-black tabular-nums text-white">${r.sales.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'sales' && (
              <motion.div
                key="sales"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={isDesktopLayout ? 'mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,28rem)_minmax(0,1fr)] items-start gap-8 pb-8' : 'max-w-md mx-auto space-y-4 pb-24'}
              >
                <div className="space-y-4">
                {/* Lottery Selector */}
                <div className="glass-card p-3 flex items-center justify-between relative z-30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-white/70 leading-none mb-1">Sorteo Activo</p>
                      {isMultipleMode ? (
                        <div className="relative">
                          <button 
                            onClick={() => setShowMultiSelect(!showMultiSelect)}
                            className="text-sm font-bold truncate flex items-center gap-1 w-full text-left"
                          >
                            {multiLottery.length === 0 ? 'Seleccione Sorteos' : `${multiLottery.length} Sorteos`}
                            <ChevronDown className={`w-3 h-3 transition-transform ${showMultiSelect ? 'rotate-180' : ''}`} />
                          </button>
                          
                              {showMultiSelect && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-40" 
                                    onClick={() => setShowMultiSelect(false)}
                                  />
                                  <div className="fixed inset-x-3 bottom-24 bg-background border border-border rounded-xl shadow-2xl z-50 p-2 space-y-1 max-h-[60vh] overflow-y-auto sm:absolute sm:top-full sm:left-0 sm:bottom-auto sm:inset-x-auto sm:mt-2 sm:w-full sm:min-w-[240px] sm:max-h-80">
                                    {activeLotteries.length > 0 ? (
                                      <>
                                        <div className="flex items-center justify-between p-2 border-b border-white/10 mb-1">
                                          <button 
                                            onClick={() => setMultiLottery(activeLotteries.map(l => l.name))}
                                            className="text-xs font-extrabold uppercase text-primary hover:text-primary/80"
                                          >
                                            Todos
                                          </button>
                                          <button 
                                            onClick={() => setMultiLottery([])}
                                            className="text-xs font-extrabold uppercase text-red-500 hover:text-red-400"
                                          >
                                            Ninguno
                                          </button>
                                        </div>
                                        {activeLotteries.map(l => (
                                          <label key={l.id} className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
                                            <input 
                                              type="checkbox" 
                                              checked={multiLottery.includes(l.name)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setMultiLottery([...multiLottery, l.name]);
                                                } else {
                                                  setMultiLottery(multiLottery.filter(name => name !== l.name));
                                                }
                                              }}
                                              className="rounded border-border text-primary focus:ring-primary bg-transparent"
                                            />
                                            <span className="text-xs font-bold">{cleanText(l.name)}</span>
                                          </label>
                                        ))}
                                      </>
                                    ) : (
                                      <div className="p-4 text-center text-xs text-muted-foreground">
                                        No hay sorteos disponibles
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                        </div>
                      ) : (
                        <select 
                          value={selectedLottery}
                          onChange={(e) => setSelectedLottery(e.target.value)}
                          className="bg-transparent border-none p-0 font-bold text-sm focus:outline-none w-full truncate"
                        >
                          <option key="default" value="" className="bg-background">
                            {activeLotteries.length > 0 ? "Seleccione Sorteo" : "Sin sorteos activos"}
                          </option>
                          {activeLotteries.map(l => (
                            <option key={l.id} value={l.name} className="bg-background">
                              {cleanText(l.name)} {l.drawTime ? `(${formatTime12h(l.drawTime)})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      const next = !isMultipleMode;
                      setIsMultipleMode(next);
                      if (next) setShowMultiSelect(true);
                    }}
                    className={`px-4 py-2.5 rounded-xl text-xs font-extrabold uppercase transition-all border ${
                      isMultipleMode ? 'bg-primary border-primary text-primary-foreground' : 'bg-white/5 border-border text-muted-foreground'
                    }`}
                  >
                    Multi
                  </button>
                </div>

                {/* Bet Type Selector */}
                <div className="bg-white/5 border border-border rounded-2xl p-1 flex gap-1">
                  <button
                    onClick={() => {
                      setBetType('CH');
                      setNumber('');
                      setQuantity('1');
                      setFocusedField('number');
                    }}
                    className={`flex-1 py-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${
                      betType === 'CH' ? 'bg-primary text-primary-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Chance
                  </button>
                  {globalSettings.palesEnabled && (isMultipleMode ? multiLottery.some(name => lotteryAllowsPale(findActiveLotteryByName(name))) : lotteryAllowsPale(findActiveLotteryByName(selectedLottery))) && (
                    <button
                      onClick={() => {
                        setBetType('PL');
                        setNumber('');
                        setQuantity('1');
                        setPlAmount('1.00');
                        setFocusedField('number');
                      }}
                      className={`flex-1 py-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${
                        betType === 'PL' ? 'bg-primary text-primary-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Palé
                    </button>
                  )}
                  {globalSettings.billetesEnabled && (isMultipleMode ? multiLottery.some(name => { const l = findActiveLotteryByName(name); return lotteryAllowsBillete(l) && !!l && isBilleteOpenForSales(l); }) : (() => { const l = findActiveLotteryByName(selectedLottery); return lotteryAllowsBillete(l) && !!l && isBilleteOpenForSales(l); })()) && (
                    <button
                      onClick={() => {
                        setBetType('BL');
                        setNumber('');
                        setQuantity('1');
                        setPlAmount('1.00');
                        setFocusedField('number');
                      }}
                      className={`flex-1 py-3 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${
                        betType === 'BL' ? 'bg-primary text-primary-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Billete
                    </button>
                  )}
                </div>

                {/* Input Boxes */}
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => {
                      setFocusedField('number');
                      numberInputRef.current?.focus();
                    }}
                    className={`glass-card rounded-xl bg-white/5 p-2.5 flex flex-col items-center justify-center gap-0.5 transition-all border-2 cursor-pointer ${
                      focusedField === 'number' ? 'border-primary bg-primary/5' : 'border-white/10'
                    }`}
                  >
                    <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-extrabold">Número</span>
                    <div className="flex items-center justify-center min-h-[32px] relative w-full">
                      <input
                        ref={numberInputRef}
                        type="text"
                        inputMode="none"
                        value={number === 'NaN' ? '' : number}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          const maxLen = betType === 'CH' ? 2 : 4;
                          if (val.length <= maxLen) {
                            setNumber(val);
                            if (val.length === maxLen) {
                              setFocusedField('amount');
                              setIsAmountSelected(true);
                              setTimeout(() => {
                                amountInputRef.current?.focus();
                                amountInputRef.current?.select();
                              }, 0);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && number.length === (betType === 'CH' ? 2 : 4)) {
                            setFocusedField('amount');
                            setIsAmountSelected(true);
                            setTimeout(() => {
                              amountInputRef.current?.focus();
                              amountInputRef.current?.select();
                            }, 0);
                          }
                        }}
                        onFocus={() => setFocusedField('number')}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <span className="text-2xl font-bold tracking-widest">
                        {number || (betType === 'CH' ? '--' : '----')}
                      </span>
                      {focusedField === 'number' && <Cursor />}
                    </div>
                  </div>
                  <div
                    onClick={() => {
                      setFocusedField('amount');
                      setIsAmountSelected(true);
                      setTimeout(() => {
                        amountInputRef.current?.focus();
                        amountInputRef.current?.select();
                      }, 0);
                    }}
                    className={`glass-card rounded-xl bg-white/5 p-2.5 flex flex-col items-center justify-center gap-0.5 transition-all border-2 cursor-pointer ${
                      focusedField === 'amount' ? 'border-primary bg-primary/5' : 'border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono uppercase tracking-wider text-white/70 font-extrabold">
                        {betType === 'CH' ? 'Cantidad' : 'Inversión'}
                      </span>
                      {betType === 'CH' && (globalSettings.chancePrices?.length || 0) > 1 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setShowChancePriceMenu(prev => !prev); }}
                            className="flex items-center gap-0.5 rounded-md bg-white/10 px-1.5 text-[10px] font-extrabold text-white/80 tabular-nums"
                          >
                            ${chancePrice.toFixed(2)} <ChevronDown className="w-3 h-3" />
                          </button>
                          {showChancePriceMenu && (
                            <div className="absolute top-full right-0 mt-1 z-20 w-24 rounded-lg border border-white/10 bg-background p-1 shadow-lg">
                              {[...(globalSettings.chancePrices || [])].sort((a, b) => a.price - b.price).map((config, index) => (
                                <button
                                  key={`sale-price-${config.price}-${index}`}
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); selectChancePrice(config.price); setShowChancePriceMenu(false); }}
                                  className={`block w-full rounded-md px-2 py-1.5 text-left text-xs font-extrabold tabular-nums ${
                                    Math.abs(config.price - chancePrice) < 0.001 ? 'bg-primary text-primary-foreground' : 'text-white/80 hover:bg-white/10'
                                  }`}
                                >
                                  ${config.price.toFixed(2)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-center min-h-[32px] relative w-full">
                      <input
                        ref={amountInputRef}
                        type="text"
                        inputMode="none"
                        value={betType === 'CH' ? (quantity === 'NaN' ? '' : quantity) : (plAmount === 'NaN' ? '' : plAmount)}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '');
                          setIsAmountSelected(false);
                          if (betType === 'CH') {
                            setQuantity(val);
                          } else {
                            setPlAmount(val);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            addToCart();
                          }
                        }}
                        onFocus={() => {
                          setFocusedField('amount');
                          setIsAmountSelected(true);
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <span className={`text-2xl font-bold ${isAmountSelected && focusedField === 'amount' ? 'bg-primary/30 text-primary px-1 rounded' : ''}`}>
                        {betType === 'CH' ? quantity : plAmount}
                      </span>
                      {focusedField === 'amount' && <Cursor />}
                    </div>
                    <span className="text-sm font-mono font-extrabold text-white/80">
                      {betType === 'CH' ? `$${(parseFloat(quantity) * chancePrice || 0).toFixed(2)}` : `USD`}
                    </span>
                  </div>
                </div>

                {/* Numeric Keyboard */}
                <div className="py-2">
                  <NumericKeyboard 
                    onKeyPress={handleKeyPress}
                    onBackspace={handleBackspace}
                    onClear={handleClear}
                  />
                </div>

                {/* Add Button */}
                <button
                  onClick={addToCart}
                  className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-widest text-base shadow-xl shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  <Plus className="w-5 h-5" />
                  Agregar al Ticket
                </button>

                </div>
                <div className="space-y-4">
                {/* Cart Preview (Compact) */}
                {cart.length > 0 && (
                  <div className="glass-card p-3 space-y-2">
                    <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Carrito ({cart.length})</h3>
                      <button onClick={clearCart} className="text-[11px] font-bold uppercase text-red-500">Vaciar</button>
                    </div>
                    <div className={`${isDesktopLayout ? 'max-h-[45vh]' : 'max-h-32'} overflow-y-auto space-y-2 custom-scrollbar pr-1`}>
                      {Object.entries(
                        cart.reduce((acc, bet, idx) => {
                          if (!acc[bet.lottery]) acc[bet.lottery] = [];
                          acc[bet.lottery].push({ ...bet, originalIdx: idx });
                          return acc;
                        }, {} as Record<string, (Bet & { originalIdx: number })[]>)
                      ).map(([lotteryName, bets]) => {
                        const betList = bets as (Bet & { originalIdx: number })[];
                        return (
                        <div key={lotteryName} className="space-y-1.5 bg-black/20 p-2 rounded-xl border border-white/5">
                          <div className="text-xs font-extrabold uppercase tracking-widest text-primary flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-primary rounded-full"></span>
                            {cleanText(lotteryName)}
                            <span className="text-muted-foreground ml-auto bg-white/5 px-1.5 py-0.5 rounded">({betList.length})</span>
                          </div>
                          <div className="space-y-1">
                            {betList.map((bet) => (
                              <div key={`${bet.lottery}-${bet.number}-${bet.type}-${bet.originalIdx}`} className="flex items-center justify-between text-xs bg-white/5 p-1.5 rounded-lg border border-white/5">
                                <div className="flex items-center gap-2 overflow-hidden">
                                  <span className="font-mono font-bold text-primary shrink-0">{getBetTypeLabel(bet.type)}</span>
                                  <span className="font-bold tracking-widest shrink-0">{bet.number}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="flex items-center gap-1 bg-white/10 rounded-lg px-1.5 py-0.5 border border-white/10">
                                    <button 
                                      onClick={() => bet.type === 'BL' ? updateCartItemAmount(bet.originalIdx, Math.max(0.1, bet.amount - 0.1)) : updateCartItemQuantity(bet.originalIdx, bet.quantity - 1)}
                                      className="p-1.5 text-muted-foreground hover:text-primary transition-colors active:scale-90"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <div className="flex flex-col items-center min-w-[50px] px-1">
                                      <span className="text-[11px] font-mono font-bold opacity-70 leading-none mb-0.5">
                                        {bet.type === 'BL' ? 'INV' : `QTY:${bet.quantity}`}
                                        {bet.type === 'CH' && (globalSettings.chancePrices?.length || 0) > 1 && ` @${getBetUnitPrice(bet).toFixed(2)}`}
                                      </span>
                                      <span className="font-black text-[11px] leading-none">
                                        ${bet.amount.toFixed(2)}
                                      </span>
                                    </div>
                                    <button 
                                      onClick={() => bet.type === 'BL' ? updateCartItemAmount(bet.originalIdx, bet.amount + 0.1) : updateCartItemQuantity(bet.originalIdx, bet.quantity + 1)}
                                      className="p-1.5 text-muted-foreground hover:text-primary transition-colors active:scale-90"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <button onClick={() => removeFromCart(bet.originalIdx)} className="text-red-500/70 hover:text-red-500 p-1.5 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-col gap-3 pt-3 border-t border-white/10">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Total</span>
                          {editingTicketId && (
                            <span className="text-[11px] font-black text-primary uppercase animate-pulse">Editando Ticket</span>
                          )}
                        </div>
                        <span className="text-xl font-black text-primary">${cartTotal.toFixed(2)}</span>
                      </div>
                      <div className="flex gap-2">
                        {editingTicketId && (
                          <button 
                            onClick={cancelEdit}
                            className="flex-1 py-3 bg-red-500/10 text-red-400 rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-transform border border-red-500/20"
                          >
                            Cancelar
                          </button>
                        )}
                        <button 
                          onClick={handleSell}
                          className="flex-1 py-3 bg-white text-black rounded-xl text-xs font-black uppercase tracking-widest active:scale-95 transition-transform"
                        >
                          {editingTicketId ? 'Actualizar Ticket' : 'Generar Ticket'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fast Entry Button */}
                <button 
                  onClick={() => setShowFastEntryModal(true)}
                  className="w-full py-3 bg-white/5 border border-border rounded-xl text-xs font-extrabold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-all flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Copiado Rápido
                </button>

                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="space-y-6"
              >
                {/* Filters */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xs font-black text-white uppercase tracking-[0.2em]">RESUMEN DE VENTAS</h2>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <button
                        type="button"
                        onClick={() => setShowTicketScanner(true)}
                        className="flex items-center justify-center gap-2 bg-primary/15 text-primary border border-primary/20 px-4 py-2.5 rounded-full text-xs font-black uppercase tracking-widest hover:bg-primary/25 transition-all"
                      >
                        <ScanQrCode className="w-3.5 h-3.5" />
                        Verificar QR
                      </button>
                      <div className="flex gap-1 bg-black/40 p-1 rounded-full border border-white/5 overflow-x-auto custom-scrollbar">
                        {['TODO', 'CHANCE', 'BILLETE', 'PALE'].map((f) => (
                          <button
                            key={f}
                            onClick={() => setHistoryFilter(f as any)}
                            className={`px-4 py-2.5 rounded-full text-xs font-black transition-all whitespace-nowrap ${
                              historyFilter === f 
                                ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      {canViewOtherSellersHistory && (
                        <select
                          value={historySellerEmail}
                          onChange={(e) => setHistorySellerEmail(e.target.value)}
                          className="rounded-full border border-white/10 bg-black/40 px-4 py-2.5 text-xs font-black text-white focus:border-primary/50 focus:outline-none"
                        >
                          <option value="">Mis ventas</option>
                          {users
                            .filter(u => u.email && u.email.toLowerCase() !== user?.email?.toLowerCase())
                            .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
                            .map(u => (
                              <option key={u.email} value={u.email.toLowerCase()} className="bg-[#111827]">
                                {getUserLabel(u)}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </div>
                  {historyViewingOtherSeller && historyStats && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { label: 'Ventas', value: historyStats.sales, color: 'text-white' },
                        { label: 'Comisión', value: historyStats.commissions, color: 'text-orange-400' },
                        { label: 'Premios', value: historyStats.prizes, color: 'text-red-500' },
                        { label: 'Utilidad', value: historyStats.bankProfit, color: historyStats.bankProfit < 0 ? 'text-red-500' : 'text-emerald-400' }
                      ].map(card => (
                        <div key={card.label} className="rounded-xl border border-white/5 bg-[#111827] px-2 py-2 text-center">
                          <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">{card.label}</p>
                          <p className={`text-[12px] font-black leading-tight ${card.color}`}>${card.value.toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tickets List */}
                <div className="space-y-4">
                  {historyLotteryCards.map(card => {
                    const {
                      lot,
                      resultForLottery,
                      sales,
                      netProfit,
                      isLoss,
                      paginatedTickets,
                      totalPages,
                      currentPage
                    } = card;
                    const isExpanded = expandedLotteries.includes(lot.id);

                    return (
                      <div key={lot.id} className={`overflow-hidden rounded-xl border transition-all ${isLoss ? 'bg-red-900/20 border-red-900/50' : 'bg-[#111827] border-gray-800'} group`}>
                        <div 
                          onClick={() => {
                            setExpandedLotteries(prev => 
                              prev.includes(lot.id) ? prev.filter(id => id !== lot.id) : [...prev, lot.id]
                            );
                          }}
                          className={`w-full px-3 py-2 flex items-center justify-between transition-all hover:bg-white/[0.02] cursor-pointer ${isExpanded ? 'bg-white/[0.02]' : ''}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-white/5 text-white/60 flex items-center justify-center">
                              {isExpanded ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                            </div>
                            <div className="flex flex-col items-start">
                              <div className="flex items-center gap-1">
                                {!isLotteryOpenForSales(lot) && <Lock className="w-2.5 h-2.5 text-red-500" />}
                                <span className="text-xs font-black uppercase tracking-tight text-white/90">
                                  {lot.name}
                                </span>
                              </div>
                              <span className="text-[11px] font-bold text-muted-foreground opacity-80">
                                {lot.drawTime ? formatTime12h(lot.drawTime) : ''}
                              </span>
                            </div>
                          </div>

                          {resultForLottery && (
                            <div className="flex gap-0.5">
                              {[resultForLottery.firstPrize, resultForLottery.secondPrize, resultForLottery.thirdPrize].map((num, i) => (
                                <span key={i} className="text-[11px] font-black bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded">
                                  {lot.isFourDigits ? num : num.slice(-2)}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="text-right flex items-center gap-2">
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] font-extrabold text-white/70 uppercase">Vendido</span>
                              <span className="text-xs font-black text-white">${sales.toFixed(2)}</span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] font-extrabold text-white/70 uppercase">Utilidad</span>
                              <span className={`text-xs font-black ${isLoss ? 'text-red-500' : 'text-green-500'}`}>${netProfit.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                        
                        {isExpanded && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden bg-black/30 border-t border-white/5"
                          >
                                <div className="space-y-3 p-4">
                                  {paginatedTickets.map(({ t: ticket }) => {
                                    const { totalPrize, winningBets } = getTicketPrizes(ticket, lot.name, historyTypeFilterCode);
                                    const ticketDate = getTicketDateKey(ticket);
                                    const hasPale13SimulationWin = canViewPaleSimulation
                                      && ticket.status !== 'cancelled'
                                      && (ticket.bets || []).some(bet => {
                                        const result = results.find(r => normalizePlainText(r.lotteryName) === normalizePlainText(bet.lottery) && r.date === ticketDate);
                                        return getPale13Simulation(bet, result, globalSettings, paleSimulationSettings) !== null;
                                      });

                                    return (
                                      <div key={ticket.id} className={`glass-card p-2 border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-all relative overflow-hidden ${totalPrize > 0 || hasPale13SimulationWin ? 'ring-1 ring-green-500/30' : ''}`}>
                                        {/* Header */}
                                        <div className="flex justify-between items-start mb-1">
                                          <div className="space-y-0.5">
                                            <div className="flex items-center gap-2">
                                              <h3 className="text-xs font-black tracking-tight text-white/90">
                                                {ticket.id.slice(0, 8).toUpperCase()}
                                              </h3>
                                              <span className="text-[11px] font-extrabold text-muted-foreground bg-white/5 px-1 rounded">
                                                {getUserLabel({ email: ticket.sellerEmail, name: ticket.sellerName }) || ticket.sellerCode || '---'}
                                              </span>
                                              {new Set(ticket.bets.map(b => b.lottery)).size > 1 && (
                                                <Layers className="w-3 h-3 text-muted-foreground" />
                                              )}
                                            </div>
                                            
                                            <div className="flex items-center gap-1 py-0.5">
                                              {ticket.status === 'active' && !isTicketClosed(ticket) && !isTicketHasResults(ticket) && ticket.sellerEmail?.toLowerCase() === user?.email?.toLowerCase() && (
                                                <button 
                                                  onClick={() => editTicket(ticket)}
                                                  className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-colors"
                                                  title="Editar Ticket"
                                                >
                                                  <Edit2 className="w-3 h-3" />
                                                </button>
                                              )}
                                              {ticket.sellerEmail?.toLowerCase() === user?.email?.toLowerCase() && (
                                                <button 
                                                  onClick={() => reuseTicket(ticket)}
                                                  className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-colors"
                                                  title="Reutilizar Ticket"
                                                >
                                                  <Repeat className="w-3 h-3" />
                                                </button>
                                              )}
                                              <button 
                                                onClick={() => setShowTicketModal({ ticket, selectedLotteryName: lot.name })}
                                                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-colors"
                                                title="Previsualizar Ticket"
                                              >
                                                <TicketIcon className="w-3 h-3" />
                                              </button>
                                              {ticket.status === 'active' && !isTicketClosed(ticket) && !isTicketHasResults(ticket) && ticket.sellerEmail?.toLowerCase() === user?.email?.toLowerCase() && (
                                                <button 
                                                  onClick={() => cancelTicket(ticket.id)}
                                                  className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors"
                                                >
                                                  <XCircle className="w-3 h-3" />
                                                </button>
                                              )}
                                            </div>

                                            <div className="flex flex-col gap-0 text-[11px] font-mono font-bold text-muted-foreground">
                                              <div className="flex items-center gap-1">
                                                <Moon className="w-2.5 h-2.5" />
                                                <span>{ticket.timestamp?.toDate ? format(ticket.timestamp.toDate(), 'h:mm:ss a') : '...'}</span>
                                              </div>
                                              <p className="uppercase tracking-tighter">TX: {ticket.id.toUpperCase()}</p>
                                            </div>
                                          </div>

                                          <div className="text-right">
                                            <span className="text-xs font-black text-primary">${(ticket.totalAmount || 0).toFixed(2)}</span>
                                            {totalPrize > 0 && (
                                              <div className="flex items-center justify-end gap-1 text-green-400">
                                                <Trophy className="w-2.5 h-2.5" />
                                                <span className="text-[11px] font-black tracking-tighter">${totalPrize.toFixed(2)}</span>
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Bets Grid */}
                                        <div className="grid grid-cols-3 md:grid-cols-4 gap-1 mt-1">
                                          {(() => {
                                            const lotKey = normalizePlainText(lot.name || '');
                                            return unifyBets(
                                              (ticket.bets || []).filter(b => (
                                                b &&
                                                normalizePlainText(b.lottery || '') === lotKey &&
                                                (!historyTypeFilterCode || b.type === historyTypeFilterCode)
                                              ))
                                            ).map((b, i) => {
                                              const hasWinningBet = winningBets.some(wb => {
                                                const original = (ticket.bets || [])[wb.idx];
                                                return Boolean(
                                                  original &&
                                                  original.number === b.number &&
                                                  original.type === b.type &&
                                                  normalizePlainText(original.lottery || '') === lotKey
                                                );
                                              });
                                              const result = results.find(r => normalizePlainText(r.lotteryName) === lotKey && r.date === ticketDate);
                                              const pale13Simulation = canViewPaleSimulation && ticket.status !== 'cancelled'
                                                ? getPale13Simulation(b, result, globalSettings, paleSimulationSettings)
                                                : null;
                                              const isDisplayWinner = hasWinningBet || pale13Simulation !== null;

                                              return (
                                                <div key={`${ticket.id}-${lot.id}-${b.type}-${b.number}-${i}`} className={`flex flex-col justify-center items-center px-1.5 py-1 rounded border transition-all ${isDisplayWinner ? 'border-green-500/50 bg-green-500/20' : 'border-white/5 bg-black/40'}`}>
                                                  <div className="flex items-center gap-1">
                                                    <span className="text-xs font-black text-white">{b.number}</span>
                                                    <span className="text-[11px] font-extrabold text-muted-foreground">x{b.quantity}</span>
                                                  </div>
                                                  {pale13Simulation !== null && (
                                                    <span className="text-[8px] font-black uppercase leading-tight text-green-300">
                                                      Win {pale13Simulation.prize !== null ? `$${pale13Simulation.prize.toFixed(2)}` : ''}
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            });
                                          })()}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  
                                  {totalPages > 1 && (
                                    <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLotteryPages(prev => ({ ...prev, [lot.id]: Math.max(1, (prev[lot.id] || 1) - 1) }));
                                        }}
                                        disabled={currentPage === 1}
                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30                                         rounded text-xs font-extrabold uppercase tracking-wider transition-colors"
                                      >
                                        Anterior
                                      </button>
                                      <span className="text-xs font-mono font-bold text-muted-foreground">
                                        Página {currentPage} de {totalPages}
                                      </span>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLotteryPages(prev => ({ ...prev, [lot.id]: Math.min(totalPages, (prev[lot.id] || 1) + 1) }));
                                        }}
                                        disabled={currentPage === totalPages}
                                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30                                         rounded text-xs font-extrabold uppercase tracking-wider transition-colors"
                                      >
                                        Siguiente
                                      </button>
                                    </div>
                                  )}
                                </div>
                            </motion.div>
                          )}
                        </div>
                      );
                    })}
                </div>

                {filteredTickets.length === 0 && (
                  <div className="glass-card p-20 text-center text-muted-foreground">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-mono uppercase">No se encontraron registros</p>
                  </div>
                )}
              </motion.div>
            )}


            {activeTab === 'stats' && (
              <motion.div
                key="stats"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black uppercase tracking-tight text-white">Reportes</h2>
                      <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">Ventas y números más jugados por sorteo</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canUseGlobalScope && (
                        <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
                          <button
                            onClick={() => setShowGlobalScope(false)}
                            className={`rounded-md px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${!showGlobalScope ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-white'}`}
                          >
                            Propio
                          </button>
                          <button
                            onClick={() => setShowGlobalScope(true)}
                            className={`rounded-md px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors ${showGlobalScope ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-white'}`}
                          >
                            Global
                          </button>
                        </div>
                      )}
                      {canAccessAllUsers && (
                        <select
                          value={globalChancePriceFilter}
                          onChange={(e) => setGlobalChancePriceFilter(e.target.value)}
                          className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[10px] font-bold text-white focus:border-primary/50 focus:outline-none"
                        >
                          <option value="">Todos los precios</option>
                          {(globalSettings.chancePrices || []).map((config, index) => (
                            <option key={`stats-price-${config.price}-${index}`} value={config.price}>
                              Chance USD {config.price.toFixed(2)}
                            </option>
                          ))}
                        </select>
                      )}
                      <input 
                        type="date" 
                        value={historyDate}
                        onChange={(e) => setHistoryDate(e.target.value)}
                        className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[10px] font-bold text-white focus:border-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div
                    role="group"
                    aria-label="Filtrar reportes por tipo de apuesta"
                    className="flex w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1 sm:w-fit"
                  >
                    {statsReportFilterOptions.map(filter => (
                      <button
                        key={filter.id}
                        type="button"
                        aria-pressed={statsReportFilter === filter.id}
                        onClick={() => setStatsReportFilter(filter.id)}
                        className={`min-w-[76px] flex-1 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors sm:flex-none ${
                          statsReportFilter === filter.id
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                  
                  {(() => {
                    const betsByLottery: Record<string, Bet[]> = {};
                    const reportTickets = historyTickets
                      .filter(ticketMatchesGlobalChancePrice)
                      .filter(ticket => ticket.status !== 'cancelled');
                    reportTickets.forEach(t => {
                      (t.bets || []).forEach(b => {
                        if (!betsByLottery[b.lottery]) {
                          betsByLottery[b.lottery] = [];
                        }
                        betsByLottery[b.lottery].push(b);
                      });
                    });

                    const lotteryNames = Object.keys(betsByLottery).sort();

                    if (lotteryNames.length === 0) {
                      return (
                        <div className="text-center py-12                         text-muted-foreground font-semibold border border-white/5 rounded bg-black/20">
                          No hay ventas registradas para esta fecha.
                        </div>
                      );
                    }

                    return (
                      <>
                        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                        {lotteryNames.map(lotteryName => {
                          const lotteryInfo = lotteries.find(l => cleanText(l.name) === cleanText(lotteryName));
                          const timeStr = lotteryInfo?.drawTime ? formatTime12h(lotteryInfo.drawTime) : '--:--';
                          const bets = betsByLottery[lotteryName];
                          const isExpanded = expandedStats.includes(lotteryName);
                          const reportFilter = statsReportFilter;
                          const showChance = reportFilter === 'global' || reportFilter === 'chance';
                          const showCombinations = reportFilter === 'global' || reportFilter === 'billete' || reportFilter === 'pale';
                          const chanceTotals = new Map<string, number>();
                          const combinationTotals = new Map<string, number>();

                          bets.forEach(bet => {
                            if (bet.type === 'CH') {
                              chanceTotals.set(bet.number, (chanceTotals.get(bet.number) || 0) + (bet.quantity || 0));
                            } else {
                              const key = `${bet.type} ${bet.number}`;
                              combinationTotals.set(key, (combinationTotals.get(key) || 0) + (bet.amount || 0));
                            }
                          });

                          const chanceRows = Array.from(chanceTotals.entries())
                            .filter(([, quantity]) => quantity > 0)
                            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
                          const topChanceNumbers = new Set(chanceRows.slice(0, 3).map(([number]) => number));
                          const paleCombinationRows = Array.from(combinationTotals.entries())
                            .filter(([key]) => key.startsWith('PL ') && (reportFilter === 'global' || reportFilter === 'pale'))
                            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
                          const billeteCombinationRows = Array.from(combinationTotals.entries())
                            .filter(([key]) => key.startsWith('BL ') && (reportFilter === 'global' || reportFilter === 'billete'))
                            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
                          const totalLotterySale = bets.reduce((total, bet) => total + (bet.amount || 0), 0);
                          const totalLotteryFractions = bets
                            .filter(bet => bet.type === 'CH')
                            .reduce((total, bet) => total + (bet.quantity || 0), 0);
                          const lotteryResult = results.find(result => (
                            cleanText(result.lotteryName) === cleanText(lotteryName) && result.date === historyDate
                          ));
                          const winningChanceNums = lotteryResult
                            ? [lotteryResult.firstPrize, lotteryResult.secondPrize, lotteryResult.thirdPrize].map(p => (p || '').slice(-2))
                            : [];
                          const winningPositionLabels = ['1er', '2do', '3er'];
                          const winningPaleKeys = new Set<string>();
                          if (winningChanceNums.length === 3 && winningChanceNums.every(n => n.length === 2)) {
                            [[0, 1], [0, 2], [1, 2]].forEach(([a, b]) => {
                              winningPaleKeys.add(`PL ${winningChanceNums[a]}${winningChanceNums[b]}`);
                              winningPaleKeys.add(`PL ${winningChanceNums[b]}${winningChanceNums[a]}`);
                            });
                          }
                          const visibleBets = bets.filter(bet => (
                            reportFilter === 'global'
                            || (reportFilter === 'chance' && bet.type === 'CH')
                            || (reportFilter === 'billete' && bet.type === 'BL')
                            || (reportFilter === 'pale' && bet.type === 'PL')
                          ));
                          return (
                            <div key={lotteryName} className={`overflow-hidden rounded-[1.2rem] border transition-all duration-300 ${
                              isExpanded
                                ? 'border-primary/40 bg-card shadow-[0_0_18px_rgba(124,58,237,0.16)]'
                                : 'border-white/10 bg-card'
                            }`}>
                              <button
                                aria-expanded={isExpanded}
                                onClick={() => setExpandedStats(prev => prev.includes(lotteryName) ? [] : [lotteryName])}
                                className="flex w-full items-center justify-between gap-2 p-2.5 text-left transition-colors hover:bg-white/5 sm:p-3"
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1">
                                  <motion.span
                                    animate={{ rotate: isExpanded ? 180 : 0 }}
                                    className="shrink-0 text-muted-foreground"
                                  >
                                    <ChevronDown className="h-4 w-4" />
                                  </motion.span>
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <h3 className="truncate text-xs font-black tracking-tight text-white sm:text-sm">{cleanText(lotteryName)}</h3>
                                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{timeStr}</span>
                                    </div>
                                    <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">
                                      ${totalLotterySale.toFixed(2)} vendidos
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <span className="min-w-[66px] rounded-lg border border-primary/20 bg-primary/10 px-2 py-1.5 text-center">
                                    <span className="block text-[7px] font-black uppercase tracking-widest text-primary">Fracciones</span>
                                    <span className="block text-xs font-black leading-tight text-white">{totalLotteryFractions}</span>
                                  </span>
                                  <span className="hidden min-w-[74px] rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-center sm:block">
                                    <span className="block text-[7px] font-black uppercase tracking-widest text-muted-foreground">Vendido</span>
                                    <span className="block text-xs font-black leading-tight text-white">${totalLotterySale.toFixed(2)}</span>
                                  </span>
                                </div>
                              </button>

                              {isExpanded && (
                                <div className="space-y-2.5 border-t border-white/5 bg-black/20 px-2.5 pb-3 sm:px-3">
                                  {lotteryResult && (
                                    <div className="mx-auto grid max-w-sm grid-cols-3 gap-1.5 pt-2.5">
                                      {[
                                        { label: '1ro', value: lotteryResult.firstPrize, tone: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' },
                                        { label: '2do', value: lotteryResult.secondPrize, tone: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
                                        { label: '3ro', value: lotteryResult.thirdPrize, tone: 'border-orange-500/30 bg-orange-500/10 text-orange-300' }
                                      ].map(prize => (
                                        <div key={prize.label} className={`flex min-w-0 flex-col items-center justify-center rounded-lg border p-1.5 ${prize.tone}`}>
                                          <span className="text-[8px] font-black uppercase tracking-widest">{prize.label}</span>
                                          <span className="max-w-full truncate text-sm font-black leading-none text-white">{prize.value || '--'}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex justify-end gap-1.5 pt-2">
                                      <button
                                        type="button"
                                        disabled={isGeneratingStatsReport || visibleBets.length === 0}
                                        onClick={() => void handleStatsReportExport(lotteryName, bets, reportFilter, 'image')}
                                        className="h-7 rounded-md border border-primary/30 bg-primary/10 px-2 text-[9px] font-black uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <Share2 className="mr-1 inline h-3 w-3" />Imagen
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isGeneratingStatsReport || visibleBets.length === 0}
                                        onClick={() => void handleStatsReportExport(lotteryName, bets, reportFilter, 'pdf')}
                                        className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-[9px] font-black uppercase text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <Share2 className="mr-1 inline h-3 w-3" />PDF
                                      </button>
                                  </div>

                                  <div className="space-y-4">
                                      {showChance && (
                                        <div>
                                          <h4 className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/80">Números (00-99) · Fracciones</h4>
                                          {chanceRows.length > 0 ? (
                                            <div className="grid grid-cols-10 gap-1">
                                              {Array.from({ length: 100 }).map((_, index) => {
                                                const number = index.toString().padStart(2, '0');
                                                const quantity = chanceTotals.get(number) || 0;
                                                const isTopSeller = topChanceNumbers.has(number);
                                                const winIndex = winningChanceNums.indexOf(number);
                                                const isWinner = winIndex >= 0;
                                                return (
                                                  <button
                                                    type="button"
                                                    key={number}
                                                    disabled={quantity <= 0}
                                                    onClick={() => openNumberTickets(reportTickets, lotteryName, 'CH', number)}
                                                    className={`relative flex min-h-10 flex-col items-center justify-center rounded-md border p-0.5 transition-transform active:scale-95 ${
                                                      isWinner && quantity > 0
                                                        ? 'z-10 border-white bg-emerald-600/95 ring-2 ring-white shadow-[0_0_8px_rgba(74,222,128,0.9)]'
                                                        : isWinner
                                                          ? 'border-yellow-300/80 bg-black/40 ring-1 ring-yellow-300/80 disabled:opacity-100'
                                                          : quantity > 0 ? 'border-primary/20 bg-primary/10' : 'border-white/5 bg-black/40'
                                                    }`}
                                                  >
                                                    <span className={`text-[9px] font-semibold leading-none ${isWinner && quantity > 0 ? 'text-white/90' : 'text-muted-foreground'}`}>{number}</span>
                                                    <span className={`mt-1 text-xs font-black leading-none ${
                                                      isWinner && quantity > 0 ? 'text-white' : isTopSeller ? 'text-red-500' : quantity > 0 ? 'text-white' : 'text-white/20'
                                                    }`}>
                                                      {quantity > 0 ? quantity : '-'}
                                                    </span>
                                                    {isWinner && (
                                                      <span className="absolute -right-0.5 -top-0.5 z-20 rounded-full bg-yellow-300 px-1 py-0.5 text-[7px] font-black leading-none text-black shadow-md ring-1 ring-black/60">
                                                        {winningPositionLabels[winIndex]}
                                                      </span>
                                                    )}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          ) : (
                                            <p className="rounded-lg border border-white/5 bg-black/20 py-3 text-center text-xs text-muted-foreground">No hay fracciones de Chance</p>
                                          )}
                                        </div>
                                      )}
                                      {showCombinations && (
                                        <div>
                                          <h4 className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/80">Combinaciones · Monto</h4>
                                          {paleCombinationRows.length + billeteCombinationRows.length > 0 ? (
                                            <div className="space-y-3">
                                              {[
                                                { title: 'Palés', rows: paleCombinationRows },
                                                { title: 'Billetes', rows: billeteCombinationRows }
                                              ].map(group => group.rows.length > 0 && (
                                                <div key={group.title}>
                                                  <h5 className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">{group.title}</h5>
                                                  <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                                                    {group.rows.map(([key, total]) => {
                                                      const isActualWinner = Boolean(lotteryResult) && evaluateBetPrizes(
                                                        { type: key.startsWith('PL ') ? 'PL' : 'BL', number: key.slice(3), amount: 1 },
                                                        lotteryResult!,
                                                        globalSettings
                                                      ).length > 0;
                                                      const pale13Simulation = canViewPaleSimulation && key.startsWith('PL ') && lotteryResult
                                                        ? getPale13Simulation(
                                                            { type: 'PL', number: key.slice(3), amount: total },
                                                            lotteryResult,
                                                            globalSettings,
                                                            paleSimulationSettings
                                                          )
                                                        : null;
                                                      const isWinningPale = isActualWinner || pale13Simulation !== null;
                                                      return (
                                                      <button
                                                        type="button"
                                                        key={key}
                                                        onClick={() => openNumberTickets(reportTickets, lotteryName, key.startsWith('PL ') ? 'PL' : 'BL', key.slice(3))}
                                                        className={`relative flex h-9 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 transition-transform active:scale-95 ${
                                                          isWinningPale
                                                            ? 'border-2 border-white bg-emerald-600/95 ring-2 ring-yellow-300/80 shadow-[0_0_10px_rgba(74,222,128,0.55)]'
                                                            : 'border border-primary/20 bg-primary/5'
                                                        }`}
                                                      >
                                                        <span className="text-[11px] font-bold text-white">{key}</span>
                                                        <span className={`text-[11px] font-semibold ${isWinningPale ? 'text-white/80' : 'text-muted-foreground'}`}>-</span>
                                                        <span className={`text-[11px] font-black ${isWinningPale ? 'text-white' : 'text-primary'}`}>${total.toFixed(2)}</span>
                                                        {isWinningPale && (
                                                          <span className="absolute -right-1 -top-1 rounded-full bg-yellow-300 px-1.5 py-0.5 text-[7px] font-black uppercase leading-none text-black shadow-md ring-1 ring-black/60">
                                                            Win
                                                          </span>
                                                        )}
                                                      </button>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="rounded-lg border border-white/5 bg-black/20 py-3 text-center text-xs text-muted-foreground">No hay combinaciones</p>
                                          )}
                                        </div>
                                      )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </motion.div>
            )}

            {activeTab === 'cierres' && (
              <motion.div
                key="cierres"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="glass-card p-4 sm:p-6 border border-white/5">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <div>
                      <h2 className="text-xl font-extrabold text-white">Cierres de Sorteo</h2>
                      <p className="text-sm font-semibold text-muted-foreground mt-1">Genera y comparte el reporte de ventas por sorteo</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                      {canUseGlobalScope && (
                        <div className="flex bg-black/30 border border-white/10 rounded overflow-hidden">
                          <button
                            onClick={() => setShowGlobalScope(false)}
                            className={`px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${!showGlobalScope ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-white'}`}
                          >
                            Propio
                          </button>
                          <button
                            onClick={() => setShowGlobalScope(true)}
                            className={`px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${showGlobalScope ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-white'}`}
                          >
                            Global
                          </button>
                        </div>
                      )}
                      {canAccessAllUsers && (
                        <select
                          value={globalChancePriceFilter}
                          onChange={(e) => setGlobalChancePriceFilter(e.target.value)}
                          className="bg-black/30 border border-white/10 p-2 rounded text-sm text-white focus:outline-none                           focus:border-primary/50 font-semibold w-full sm:w-auto"
                        >
                          <option value="">Todos los precios</option>
                          {(globalSettings.chancePrices || []).map((config, index) => (
                            <option key={`cierre-price-${config.price}-${index}`} value={config.price}>
                              Chance USD {config.price.toFixed(2)}
                            </option>
                          ))}
                        </select>
                      )}
                      <input 
                        type="date" 
                        value={historyDate}
                        onChange={(e) => setHistoryDate(e.target.value)}
                        className="bg-black/30 border border-white/10 p-2 rounded text-sm text-white focus:outline-none                         focus:border-primary/50 font-semibold w-full sm:w-auto"
                      />
                    </div>
                  </div>

                  {(() => {
                    const scopedTickets = historyTickets.filter(t => {
                      if (t.status === 'cancelled') return false;
                      if (!ticketMatchesGlobalChancePrice(t)) return false;
                      if (canAccessAllUsers) return true;
                      return t.sellerId === user?.uid || t.sellerEmail?.toLowerCase() === user?.email?.toLowerCase();
                    });
                    const cierreCards = sortedLotteries.map(lot => {
                      const bets = scopedTickets
                        .flatMap(t => t.bets || [])
                        .filter(b => b && cleanText(b.lottery) === cleanText(lot.name));
                      const totalVendido = bets.reduce((sum, b) => sum + (b.amount || 0), 0);
                      return { lot, bets, totalVendido };
                    }).filter(card => card.totalVendido > 0);

                    if (cierreCards.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-12 text-center">
                          <Share2 className="mb-3 h-8 w-8 text-slate-600" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">No hay ventas registradas</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {cierreCards.map(({ lot, bets, totalVendido }) => {
                          const isOpen = expandedCierres.includes(lot.id);
                          const chanceTotals = new Map<string, number>();
                          const combos: Record<string, { type: string; number: string; amount: number }> = {};
                          bets.forEach(b => {
                            if (b.type === 'CH') {
                              chanceTotals.set(b.number, (chanceTotals.get(b.number) || 0) + (b.quantity || 0));
                            } else {
                              const key = `${b.type}-${b.number}`;
                              combos[key] = { type: b.type, number: b.number, amount: (combos[key]?.amount || 0) + (b.amount || 0) };
                            }
                          });
                          const comboList = Object.values(combos).sort((a, b) => b.amount - a.amount);

                          return (
                            <div key={lot.id} className="overflow-hidden rounded-xl border border-gray-800 bg-[#111827]">
                              <div className="flex items-center justify-between gap-3 p-3">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <Clock className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <h3 className="truncate text-xs font-black uppercase tracking-tight text-white">{cleanText(lot.name)}</h3>
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                                      {lot.drawTime ? formatTime12h(lot.drawTime) : 'Sorteo'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedCierres(prev => prev.includes(lot.id) ? prev.filter(id => id !== lot.id) : [...prev, lot.id])}
                                    aria-expanded={isOpen}
                                    title={isOpen ? 'Ocultar detalle' : 'Ver detalle'}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300"
                                  >
                                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStatsReportExport(lot.name, bets, 'global', 'image')}
                                    disabled={isGeneratingStatsReport}
                                    title="Compartir como imagen"
                                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-all active:scale-90 disabled:opacity-50"
                                  >
                                    <Share2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStatsReportExport(lot.name, bets, 'global', 'pdf')}
                                    disabled={isGeneratingStatsReport}
                                    title="Compartir como PDF"
                                    className="flex h-9 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-[10px] font-black text-white transition-all active:scale-90 disabled:opacity-50"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    PDF
                                  </button>
                                </div>
                              </div>
                              <div className="mx-3 flex items-center justify-between border-t border-white/5 py-2">
                                <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                                  <Lock className="h-3 w-3" />
                                  Total vendido
                                </span>
                                <span className="text-base font-black text-primary">${totalVendido.toFixed(2)}</span>
                              </div>
                              {isOpen && (
                                <div className="bg-black/20 px-3 pb-4">
                                  <div className="border-t border-white/5 pt-3">
                                    <h4 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-300">Chances vendidos por número</h4>
                                    <div className="grid grid-cols-10 gap-1 rounded-lg border border-white/5 bg-black/20 p-1">
                                      {Array.from({ length: 100 }, (_, i) => {
                                        const num = String(i).padStart(2, '0');
                                        const qty = chanceTotals.get(num) || 0;
                                        return (
                                          <button
                                            type="button"
                                            key={num}
                                            disabled={!qty}
                                            onClick={() => openNumberTickets(scopedTickets, lot.name, 'CH', num)}
                                            className="flex min-h-10 flex-col items-center justify-center rounded bg-white/[0.03] px-0.5 py-1 transition-transform active:scale-95"
                                          >
                                            <span className="text-[8px] font-bold text-slate-400">{num}</span>
                                            <span className={`text-[9px] font-black ${qty ? 'text-emerald-300' : 'text-slate-700'}`}>{qty || '-'}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div className="mt-4">
                                    <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-300">
                                      <Layers className="h-3 w-3 text-primary" />
                                      Combinaciones vendidas
                                    </h4>
                                    {comboList.length > 0 ? (
                                      <div className="space-y-3">
                                        {[
                                          { title: 'Palés', label: 'Palé', rows: comboList.filter(combo => combo.type === 'PL') },
                                          { title: 'Billetes', label: 'Billete', rows: comboList.filter(combo => combo.type !== 'PL') }
                                        ].map(group => group.rows.length > 0 && (
                                          <div key={group.title}>
                                            <h5 className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">{group.title}</h5>
                                            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                                              {group.rows.map(combo => (
                                                <button
                                                  type="button"
                                                  key={`${combo.type}-${combo.number}`}
                                                  onClick={() => openNumberTickets(scopedTickets, lot.name, combo.type === 'PL' ? 'PL' : 'BL', combo.number)}
                                                  className="flex h-9 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-primary/20 bg-primary/5 px-2 transition-transform active:scale-95"
                                                >
                                                  <span className="text-[11px] font-bold text-white">{group.label} {combo.number}</span>
                                                  <span className="text-[11px] font-semibold text-muted-foreground">-</span>
                                                  <span className="text-[11px] font-black text-primary">${combo.amount.toFixed(2)}</span>
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-center text-[9px] font-bold text-slate-500">No hay combinaciones vendidas para este sorteo.</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            )}

            {activeTab === 'results' && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-violet-950 via-slate-950 to-purple-950 p-4 shadow-lg shadow-violet-950/30 md:p-6">
                  <div className="pointer-events-none absolute -right-6 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
                  <div className="relative flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-inner shadow-primary/10">
                      <Trophy className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black tracking-tight text-white uppercase md:text-3xl">Resultados de Sorteos</h2>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-violet-200/80 md:text-xs">
                        {canManageResults ? 'Ingreso y control de resultados en tiempo real' : 'Últimos resultados publicados'}
                      </p>
                    </div>
                  </div>
                </div>

                {canManageResults && resultEditorOpen && resultFormLotteryId && (
                  <div
                    className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) closeResultEditor(); }}
                  >
                    <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-[#0B1220] p-4 shadow-2xl">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-black uppercase text-white">{cleanText(lotteryById.get(resultFormLotteryId)?.name || editingResult?.lotteryName || '')}</h3>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {lotteryById.get(resultFormLotteryId)?.drawTime ? formatTime12h(lotteryById.get(resultFormLotteryId)!.drawTime) : '--:--'} · {businessDayKey}
                          </p>
                        </div>
                        <button onClick={closeResultEditor} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:text-white">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          [resultFormFirstPrize, setResultFormFirstPrize, '1er', 'border-yellow-400/50 bg-yellow-500/20 text-yellow-200'],
                          [resultFormSecondPrize, setResultFormSecondPrize, '2do', 'border-violet-400/50 bg-violet-500/20 text-violet-200'],
                          [resultFormThirdPrize, setResultFormThirdPrize, '3er', 'border-orange-400/50 bg-orange-500/20 text-orange-200']
                        ] as const).map(([value, setValue, label, tone]) => (
                          <div key={label} className="flex flex-col items-center gap-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">{label}</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={lotteryById.get(resultFormLotteryId)?.isFourDigits ? 4 : 2}
                              value={value}
                              onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
                              className={`h-12 w-full rounded-xl border-2 text-center text-lg font-black outline-none ${tone}`}
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={handleCreateResultFromForm}
                        disabled={!resultFormLotteryId || ![resultFormFirstPrize, resultFormSecondPrize, resultFormThirdPrize].every(v => v.length === (lotteryById.get(resultFormLotteryId)?.isFourDigits ? 4 : 2))}
                        className="w-full rounded-xl bg-primary py-2.5 text-xs font-black uppercase tracking-widest text-primary-foreground disabled:opacity-50"
                      >
                        {editingResult ? 'Actualizar' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {resultListItems.length === 0 ? (
                    <div className="glass-card p-4 text-center text-muted-foreground font-mono uppercase text-xs md:col-span-2 xl:col-span-3">
                      No hay resultados registrados
                    </div>
                  ) : (
                    resultListItems.map((item) => {
                      if (!item.res) {
                        const pendingLottery = item.lottery!;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => openResultEditor(pendingLottery.id)}
                            className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-900/70 p-2 text-left transition-colors hover:border-primary/40"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <p className="truncate text-xs font-black uppercase tracking-wide text-white md:text-sm">{cleanText(pendingLottery.name)}</p>
                              <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[9px] font-extrabold uppercase text-slate-300 md:text-[10px]">
                                {pendingLottery.drawTime ? formatTime12h(pendingLottery.drawTime) : '--:--'}
                              </span>
                            </div>
                            <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">Pendiente</span>
                          </button>
                        );
                      }
                      const res = item.res;
                      const stats = resultStatusMap.get(getResultKey(res));
                      const isLoss = !!stats && stats.prizes > stats.sales && stats.prizes > 0;
                      const hasWinners = !!stats && stats.hasWinners;
                      const statusTone = canManageResults
                        ? (isLoss ? 'loss' : (hasWinners ? 'winner' : 'neutral'))
                        : 'neutral';
                      const statusClasses = statusTone === 'loss'
                        ? 'border-red-400/60 bg-gradient-to-br from-red-950/90 via-red-950/50 to-slate-950 shadow-lg shadow-red-950/30'
                        : statusTone === 'winner'
                          ? 'border-emerald-400/60 bg-gradient-to-br from-emerald-950/90 via-emerald-950/45 to-slate-950 shadow-lg shadow-emerald-950/30'
                          : 'border-violet-400/30 bg-gradient-to-br from-violet-950/70 via-slate-900 to-purple-950/60 shadow-md shadow-violet-950/20';
                      const lotteryInfo = lotteryById.get(res.lotteryId);

                      return (
                        <div key={res.id} className={`glass-card rounded-xl border p-2 transition-all duration-200 ${statusClasses}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <p className="break-words text-xs font-black uppercase leading-tight tracking-wide text-white md:text-sm">{cleanText(res.lotteryName)}</p>
                                <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-300 md:text-[10px]">
                                  {lotteryInfo?.drawTime ? formatTime12h(lotteryInfo.drawTime) : '--:--'}
                                </span>
                              </div>
                            </div>
                            {canManageResults && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  onClick={() => {
                                    if (res.date !== businessDayKey) {
                                      toast.error('Solo se pueden editar resultados de la fecha operativa actual');
                                      return;
                                    }
                                    openResultEditor(res.lotteryId, res);
                                  }}
                                  disabled={res.date !== businessDayKey}
                                  className="p-1 hover:bg-white/10 rounded-lg text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                  title="Editar resultado"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (!isCeoUser && res.date !== businessDayKey) {
                                      toast.error('Solo el CEO puede eliminar resultados fuera de la fecha operativa');
                                      return;
                                    }
                                    deleteResult(res.id);
                                  }}
                                  disabled={!isCeoUser && res.date !== businessDayKey}
                                  className="p-1 hover:bg-red-400/10 rounded-lg text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                  title="Eliminar resultado"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="mt-1.5 flex gap-1.5">
                            <div className="flex h-8 min-w-10 items-center justify-center rounded-lg border border-amber-300/50 bg-gradient-to-br from-amber-400/30 to-yellow-700/20 px-2 text-sm font-black text-amber-100">{res.firstPrize}</div>
                            <div className="flex h-8 min-w-10 items-center justify-center rounded-lg border border-violet-300/50 bg-gradient-to-br from-violet-400/30 to-violet-700/20 px-2 text-sm font-black text-violet-100">{res.secondPrize}</div>
                            <div className="flex h-8 min-w-10 items-center justify-center rounded-lg border border-orange-300/50 bg-gradient-to-br from-orange-400/30 to-rose-700/20 px-2 text-sm font-black text-orange-100">{res.thirdPrize}</div>
                          </div>

                        </div>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'admin' && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                {configTabsBar}
                <div className="glass-card p-3 sm:p-6 md:p-10">
                  <div className="flex items-center justify-between gap-3 mb-4 sm:mb-8">
                    <div className="min-w-0">
                      <h2 className="text-lg sm:text-2xl font-black italic tracking-tighter neon-text uppercase">Sorteos</h2>
                      <p className="text-[10px] sm:text-xs font-mono text-muted-foreground mt-0.5 uppercase tracking-widest">Gestión de sorteos</p>
                    </div>
                    {(userProfile?.role === 'ceo' || userProfile?.role === 'programador') && (
                      <button
                        onClick={() => {
                          setEditingLottery(null);
                          setShowLotteryModal(true);
                        }}
                        className="shrink-0 bg-primary text-primary-foreground px-3 sm:px-6 py-2.5 sm:py-3 rounded-xl font-extrabold uppercase text-[11px] sm:text-xs tracking-wider flex items-center justify-center gap-1.5 hover:brightness-110 transition-all"
                      >
                        <Plus className="w-4 h-4" /> Nuevo
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {sortedLotteries.map(lot => (
                      <div key={lot.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2.5">
                        <div className="flex items-start gap-2.5">
                          <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${lot.active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="font-black uppercase tracking-tight text-sm leading-tight break-words">{cleanText(lot.name)}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] font-mono font-bold text-muted-foreground uppercase">
                              <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-primary" /> {lot.drawTime ? formatTime12h(lot.drawTime) : 'Sin horario'}</span>
                              {lot.closingTime && <span className="flex items-center gap-1 text-red-400"><XCircle className="w-3 h-3" /> {formatTime12h(lot.closingTime)}</span>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {[
                                `${lot.isFourDigits ? 4 : 2} cifras`,
                                'Chance',
                                lotteryAllowsPale(lot) && 'Palé',
                                lotteryAllowsBillete(lot) && 'Billete'
                              ].filter(Boolean).map(tag => (
                                <span key={String(tag)} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary">{tag}</span>
                              ))}
                              {!lot.active && <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-400">Pausado</span>}
                            </div>
                          </div>
                        </div>
                        {(userProfile?.role === 'ceo' || userProfile?.role === 'programador') && (
                          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                            <button
                              onClick={() => {
                                setEditingLottery(lot);
                                setShowLotteryModal(true);
                              }}
                              className="bg-white/5 hover:bg-white/10 py-2.5 rounded-lg text-[11px] font-extrabold uppercase tracking-wider transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => toggleLotteryActive(lot)}
                              className={`py-2.5 rounded-lg text-[11px] font-extrabold uppercase tracking-wider transition-colors ${
                                lot.active
                                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400'
                                  : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'
                              }`}
                            >
                              {lot.active ? 'Pausar' : 'Activar'}
                            </button>
                            <button
                              onClick={() => deleteLottery(lot.id)}
                              className="px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                    
                    {lotteries.length === 0 && (userProfile?.role === 'ceo' || userProfile?.role === 'programador') && (
                      <button 
                        onClick={async () => {
                          const defaults = [
                            { name: 'Loter\u00eda de Medell\u00edn', drawTime: '22:30', closingTime: '22:00' },
                            { name: 'Loter\u00eda de Bogot\u00e1', drawTime: '22:30', closingTime: '22:00' },
                            { name: 'Chontico D\u00eda', drawTime: '13:00', closingTime: '12:45' },
                            { name: 'Chontico Noche', drawTime: '19:00', closingTime: '18:45' },
                            { name: 'Paisa 1', drawTime: '13:00', closingTime: '12:45' },
                            { name: 'Paisa 2', drawTime: '18:00', closingTime: '17:45' }
                          ];
                          for (const lot of defaults) {
                            await addDoc(collection(db, 'lotteries'), { ...lot, active: true });
                          }
                          toast.success('Loterías iniciales creadas');
                        }}
                        className="col-span-full p-10 border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center gap-4 hover:bg-white/5 transition-all group"
                      >
                        <Settings className="w-12 h-12 text-muted-foreground group-hover:text-primary transition-colors" />
                        <div className="text-center">
                          <p className="font-black uppercase tracking-widest text-sm">Sembrar Loterías Iniciales</p>
                          <p className="text-xs font-mono font-semibold text-muted-foreground mt-1">Configura rápidamente las loterías más comunes de Colombia</p>
                        </div>
                      </button>
                    )}

                    {(userProfile?.role === 'ceo' || userProfile?.role === 'programador') && (
                      <button 
                        onClick={async () => {
                          const q = query(collection(db, 'lotteries'));
                          const snap = await getDocs(q);
                          let fixedCount = 0;
                          for (const docSnap of snap.docs) {
                            const data = docSnap.data();
                            if (data.name && (data.name.includes('??') || data.name.includes('<') || data.name.includes('Ý'))) {
                              const newName = cleanText(data.name);
                              await updateDoc(doc(db, 'lotteries', docSnap.id), { name: newName });
                              fixedCount++;
                            }
                          }
                          toast.success(`${fixedCount} loterías corregidas`);
                        }}
                        className="col-span-full p-4 border border-dashed border-primary/30 rounded-xl flex items-center justify-center gap-4 hover:bg-primary/5 transition-all group mt-4"
                      >
                        <ShieldCheck className="w-5 h-5 text-primary" />
                        <div className="text-center">
                          <p className="font-bold uppercase tracking-widest text-xs">Corregir Nombres de Loterías Corruptos</p>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* Zona de Peligro - CEO */}
                  {(userProfile?.role === 'ceo' || userProfile?.role === 'programador') && (
                    <div className="mt-12 pt-8 border-t border-red-500/20">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-red-500/5 p-8 rounded-2xl border border-red-500/10">
                        <div>
                          <h3 className="text-xl font-black italic tracking-tighter text-red-400 uppercase flex items-center gap-2">
                            <Trash2 className="w-5 h-5" /> Zona de Peligro
                          </h3>
                          <p className="text-xs font-mono text-muted-foreground mt-2 max-w-xl">
                            Esta acción eliminará permanentemente todos los registros de ventas, tickets y resultados de loterías. 
                            Solo las loterías y los usuarios se mantendrán intactos.
                          </p>
                        </div>
                        <button 
                          onClick={handleDeleteAllSalesData}
                          className="w-full md:w-auto bg-red-500/10 text-red-400 px-6 py-4 rounded-xl font-bold uppercase text-xs sm:text-sm tracking-widest flex items-center justify-center gap-3 hover:bg-red-500/20 transition-all border border-red-500/20"
                        >
                          <Trash2 className="w-5 h-5" /> Borrar Datos de Ventas
                        </button>
                      </div>
                    </div>
                  )}
              </motion.div>
            )}

            {activeTab === 'users' && (() => {
              const canManageUsers = userProfile?.role === 'ceo' || userProfile?.role === 'programador';
              const listedUsers = users.filter(u => u && u.email && (u.role !== 'programador' || userProfile?.role === 'programador'));
              if (userProfile?.email && userProfile.role === 'programador' && !listedUsers.some(u => u.email?.toLowerCase() === userProfile.email.toLowerCase())) {
                listedUsers.unshift(userProfile);
              }
              const roleOrder: Record<string, number> = { ceo: 0, programador: 1, admin: 2, seller: 3 };
              const roleLabels: Record<string, string> = { ceo: 'CEO', programador: 'Programador', admin: 'Administrador', seller: 'Vendedor' };
              const sortedUsers = [...listedUsers].sort((a, b) =>
                (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) ||
                getUserLabel(a).localeCompare(getUserLabel(b))
              );
              const toggleUserStatus = async (target: UserProfile) => {
                const nextStatus = target.status === 'active' ? 'inactive' : 'active';
                try {
                  await updateDoc(doc(db, 'users', target.email.toLowerCase()), { status: nextStatus });
                  setUsers(prev => prev.map(item => item.email?.toLowerCase() === target.email.toLowerCase() ? { ...item, status: nextStatus } : item));
                  toast.success(nextStatus === 'active' ? 'Usuario activado' : 'Usuario desactivado');
                } catch (error) {
                  handleFirestoreError(error, OperationType.UPDATE, `users/${target.email}`);
                }
              };
              const shareUserAccess = async (target: UserProfile) => {
                const text = `usuario: ${target.email}`;
                try {
                  if (navigator.share) await navigator.share({ title: 'Acceso', text });
                  else {
                    await navigator.clipboard.writeText(text);
                    toast.success('Usuario copiado');
                  }
                } catch (error) {
                  if ((error as Error)?.name !== 'AbortError') toast.error('No se pudo compartir');
                }
              };

              return (
                <motion.div
                  key="users"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  {configTabsBar}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <div>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">Gestión de Usuarios</h2>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Crea y administra los usuarios.</p>
                      </div>
                      {canManageUsers && (
                        <button
                          onClick={() => {
                            setEditingUser(null);
                            setShowUserModal(true);
                          }}
                          className="bg-primary text-primary-foreground px-4 h-10 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all shrink-0 whitespace-nowrap"
                        >
                          <Plus className="w-4 h-4" /> Añadir Usuario
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {sortedUsers.map((u, i) => {
                        const isActive = (u.status || 'active') === 'active';
                        const isProtected = u.role === 'ceo' || u.role === 'programador';
                        return (
                          <div
                            key={u.email || `user-${i}`}
                            className={`rounded-2xl border bg-white/5 p-3 ${isActive ? 'border-white/10' : 'border-red-500/20 opacity-70'}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="truncate text-sm font-bold tracking-tight text-white">{getUserLabel(u)}</h4>
                                  <span className="shrink-0 rounded-md border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[10px] font-black text-primary">{u.commissionRate ?? 0}%</span>
                                  {!isActive && (
                                    <span className="shrink-0 rounded-md border border-red-500/30 bg-red-500/20 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-red-400">Inactivo</span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate text-xs font-bold uppercase tracking-wider text-slate-400">
                                  {u.email} · {roleLabels[u.role] || u.role}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center">
                                <button onClick={() => shareUserAccess(u)} title="Compartir usuario" className="rounded-lg p-2 text-slate-500 transition-colors hover:text-white">
                                  <Share2 className="h-4 w-4" />
                                </button>
                                {canManageUsers && !isProtected && (
                                  <button
                                    onClick={() => toggleUserStatus(u)}
                                    title={isActive ? 'Desactivar' : 'Activar'}
                                    className={`rounded-lg p-2 transition-all active:scale-90 ${isActive ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-400'}`}
                                  >
                                    {isActive ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                                  </button>
                                )}
                                {canManageUsers && (
                                  <button
                                    onClick={() => {
                                      setEditingUser(u);
                                      setShowUserModal(true);
                                    }}
                                    title="Editar"
                                    className="rounded-lg p-2 text-slate-500 transition-colors hover:text-white"
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </button>
                                )}
                                {canManageUsers && !isProtected && (
                                  <button onClick={() => deleteUser(u.email)} title="Eliminar" className="rounded-lg p-2 text-slate-600 transition-colors hover:text-red-500">
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {sortedUsers.length === 0 && (
                        <p className="py-8 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">No hay usuarios</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })()}

            {activeTab === 'liquidaciones' && (() => {
              const report = liquidationReport;
              const isGlobalView = liquidationScopeEmail === allLiquidationUsersValue;
              const liquidationUsersSource = [...users];
              if (userProfile?.role === 'ceo' && userProfile.email && !liquidationUsersSource.some(u => u.email?.toLowerCase() === userProfile.email.toLowerCase())) {
                liquidationUsersSource.unshift(userProfile);
              }
              const selectableUsers = liquidationUsersSource.filter(u => u?.email && (u.status === 'active' || u.role === 'ceo') && (u.role !== 'programador' || userProfile?.role === 'programador'));
              const isPositive = (report?.totals.utility ?? 0) >= 0;
              const commissionPct = report && report.totals.sales > 0 ? (report.totals.commission / report.totals.sales) * 100 : 0;
              const metric = (value: number, color: string) => (
                <span className={`truncate text-right text-[10px] font-black ${color}`}>{value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)}</span>
              );
              const tableHead = (label: string) => (
                <div className="grid grid-cols-[1.3fr_repeat(4,minmax(0,1fr))] gap-1 border-b border-white/10 pb-1 text-[8px] font-black uppercase text-slate-500">
                  <span>{label}</span><span className="text-right">Venta</span><span className="text-right">Premio</span><span className="text-right">Com.</span><span className="text-right">Util.</span>
                </div>
              );
              const tableRow = (key: string, label: string, row: { sales: number; prizes: number; commission: number; utility: number }) => (
                <div key={key} className="grid grid-cols-[1.3fr_repeat(4,minmax(0,1fr))] items-center gap-1 border-b border-white/5 py-2">
                  <span className="min-w-0 truncate text-[10px] font-black uppercase text-white">{label}</span>
                  {metric(row.sales, 'text-white')}
                  {metric(row.prizes, 'text-rose-300')}
                  {metric(row.commission, 'text-violet-300')}
                  {metric(row.utility, row.utility >= 0 ? 'text-emerald-300' : 'text-rose-300')}
                </div>
              );

              return (
                <motion.div
                  key="liquidaciones"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-4"
                >
                  <div className="glass-card p-4 sm:p-6 space-y-4">
                    <div className="flex flex-col gap-3 border-b border-white/10 pb-3">
                      <div>
                        <h2 className="text-lg font-black italic tracking-tighter neon-text uppercase">Liquidación final</h2>
                        <p className="mt-1 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">{liquidationDateLabel}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-black/40 px-3 text-slate-300">
                          <span className="text-[9px] font-black uppercase">Desde</span>
                          <input
                            type="date"
                            value={liquidationDate}
                            onChange={(e) => setLiquidationDate(e.target.value)}
                            className="min-w-0 w-full bg-transparent text-[11px] font-bold text-white outline-none"
                          />
                        </label>
                        <label className="flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-black/40 px-3 text-slate-300">
                          <span className="text-[9px] font-black uppercase">Hasta</span>
                          <input
                            type="date"
                            value={liquidationEndDate}
                            min={liquidationDate}
                            onChange={(e) => setLiquidationEndDate(e.target.value)}
                            className="min-w-0 w-full bg-transparent text-[11px] font-bold text-white outline-none"
                          />
                        </label>
                        {canChooseLiquidationUser ? (
                          <select
                            value={selectedUserToLiquidate}
                            onChange={(e) => setSelectedUserToLiquidate(e.target.value)}
                            className="col-span-2 h-10 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-[11px] font-black uppercase tracking-widest text-slate-200 outline-none focus:border-primary"
                          >
                            <option value={allLiquidationUsersValue} className="bg-gray-900">Todos</option>
                            {selectableUsers.map((u, i) => (
                              <option key={u.email || `liq-${i}`} value={u.email} className="bg-gray-900">
                                {getUserLabel(u)}{u.sellerId ? ` · ${u.sellerId}` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="col-span-2 flex h-10 items-center rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-bold text-white">
                            {getUserLabel(userProfile) || user?.email}
                          </div>
                        )}
                        {canConfirmLiquidation && (
                          <div className="col-span-2 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => shareElementAsImage({
                                elementId: 'liquidation-report-card',
                                fileName: `Liquidacion-${liquidationDateLabel.replace(/ /g, '-')}.png`,
                                title: 'Liquidación final',
                                text: `Liquidación ${liquidationDateLabel}`,
                                dialogTitle: 'Compartir liquidación'
                              })}
                              disabled={isSharingLiquidation || !report}
                              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 active:scale-95 disabled:opacity-50"
                            >
                              <Share2 className="h-4 w-4" /> Imagen
                            </button>
                            <button
                              type="button"
                              onClick={shareLiquidationPdf}
                              disabled={isSharingLiquidation || !report}
                              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 active:scale-95 disabled:opacity-50"
                            >
                              <FileText className="h-4 w-4" /> {isGlobalView ? 'PDF global' : 'PDF'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div id="liquidation-report-card" className="space-y-4 bg-[#0f172a] p-3 rounded-xl">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-xs font-black uppercase text-white">{isGlobalView ? 'Todos los usuarios' : (report?.users[0]?.label || getUserLabel(users.find(u => (u.email || '').toLowerCase() === liquidationScopeEmail.toLowerCase())) || 'Usuario')}</p>
                        <p className="shrink-0 text-[10px] font-mono font-bold text-slate-400">{liquidationDateLabel}</p>
                      </div>

                      {liquidationDate !== businessDayKey && isLiquidationDataLoading && (
                        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Cargando datos...</p>
                      )}

                      <div className="space-y-1 px-1">
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-xs font-bold text-slate-300">Ventas brutas</span>
                          <span className="text-sm font-black text-white">${(report?.totals.sales ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-white/5 py-2.5">
                          <span className="text-xs font-bold text-slate-300">Premios</span>
                          <span className="text-sm font-black text-rose-300">-${(report?.totals.prizes ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-white/5 py-2.5">
                          <span className="text-xs font-bold text-slate-300">Comisión ({commissionPct.toFixed(2)}%)</span>
                          <span className="text-sm font-black text-violet-300">-${(report?.totals.commission ?? 0).toFixed(2)}</span>
                        </div>
                      </div>

                      <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-4 ${isPositive ? 'border-emerald-400/20 bg-emerald-500/10' : 'border-rose-400/20 bg-rose-500/10'}`}>
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-300">Utilidad</p>
                          <p className="mt-1 text-[9px] font-bold text-slate-400">Ventas - premios - comisión</p>
                        </div>
                        <p className={`shrink-0 text-xl font-black ${isPositive ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {isPositive ? '+' : '-'}${Math.abs(report?.totals.utility ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 p-3">
                      {isGlobalView && (
                        <section className="space-y-2">
                          <h3 className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Resumen por usuario</h3>
                          {report && report.users.length > 0 ? (
                            <div>
                              {tableHead('Usuario')}
                              {report.users.map(row => tableRow(row.key, row.label, row))}
                            </div>
                          ) : (
                            <p className="px-3 py-4 text-center text-xs font-bold text-slate-500">No hay ventas para esta fecha.</p>
                          )}
                        </section>
                      )}

                      <section className="space-y-2">
                        <h3 className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Resumen por sorteo</h3>
                        {report && report.draws.length > 0 ? (
                          <div>
                            {tableHead('Sorteo')}
                            {report.draws.map(row => tableRow(row.key, `${row.name}${row.time ? ` ${row.time}` : ''}`, row))}
                          </div>
                        ) : (
                          <p className="px-3 py-4 text-center text-xs font-bold text-slate-500">No hay ventas por sorteo para esta fecha.</p>
                        )}
                      </section>
                    </div>
                  </div>
                </motion.div>
              );
            })()}

            {activeTab === 'archivo' && (
              <motion.div
                key="archivo"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                <div className="glass-card p-4 sm:p-6 md:p-10">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-6">
                    <div>
                      <h2 className="text-2xl font-black italic tracking-tighter neon-text uppercase">ARCHIVO HISTÓRICO</h2>
                      <p className="text-xs font-mono text-muted-foreground mt-1 uppercase tracking-widest">Consulta de Datos y Liquidaciones Pasadas</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">Fecha a Consultar (por defecto: día anterior)</label>
                        <input 
                          type="date"
                          value={archiveDate}
                          onChange={(e) => setArchiveDate(e.target.value)}
                          className="w-full bg-black border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => applyOperationalQuickDate(setArchiveDate, 0)}
                                                        className="px-2 py-1 rounded-md bg-white/5 text-xs font-black uppercase tracking-widest"
                          >
                            Hoy
                          </button>
                          <button
                            type="button"
                            onClick={() => applyOperationalQuickDate(setArchiveDate, -1)}
                                                        className="px-2 py-1 rounded-md bg-white/5 text-xs font-black uppercase tracking-widest"
                          >
                            Ayer
                          </button>
                        </div>
                        <select
                          value={archiveDate}
                          onChange={(e) => setArchiveDate(e.target.value)}
                          className="w-full bg-black border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                        >
                          {recentOperationalDates.map(dateValue => (
                            <option key={`archive-${dateValue}`} value={dateValue} className="bg-gray-900">{dateValue}</option>
                          ))}
                        </select>
                      </div>

                      {(userProfile?.role === 'ceo' || userProfile?.canLiquidate) ? (
                        <div className="space-y-2">
                          <label className="                          text-xs font-mono font-bold uppercase tracking-widest text-white/70">Seleccionar Usuario</label>
                          <select 
                            value={archiveUserEmail}
                            onChange={(e) => setArchiveUserEmail(e.target.value)}
                            className="w-full bg-black border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                          >
                            <option key="default" value="" className="bg-gray-900">Seleccionar...</option>
                            {users.filter(u => {
                              if (!u || !u.email) return false;
                              if (u.role === 'programador' && userProfile?.role !== 'programador') return false;
                              if (userProfile?.role === 'ceo' || userProfile?.role === 'admin' || userProfile?.role === 'programador') return true;
                              return u.email === userProfile?.email;
                            }).map((u, i) => (
                              <option key={u.email || `arch-${i}`} value={u.email} className="bg-gray-900">{getUserLabel(u)}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                          <p className="                          text-xs font-mono font-bold text-white/70 uppercase tracking-widest">Usuario</p>
                          <p className="text-sm font-bold text-white">{userProfile?.name}</p>
                        </div>
                      )}

                      <button 
                        onClick={fetchArchiveData}
                        disabled={isArchiveLoading || !archiveUserEmail || !archiveDate}
                        className="w-full bg-primary text-primary-foreground font-black uppercase tracking-widest py-4 rounded-xl hover:brightness-110 transition-all mt-6 shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isArchiveLoading ? 'Cargando...' : 'Consultar Archivo'}
                      </button>
                    </div>

                    <div className="lg:col-span-2">
                      {archiveUserEmail && archiveTickets.length > 0 ? (() => {
                        const userToLiquidate = users.find(u => u.email === archiveUserEmail);
                        const summary = buildFinancialSummary({
                          tickets: archiveTickets,
                          userEmail: archiveUserEmail,
                          targetDate: archiveDate
                        });

                        return (
                          <div className="glass-card p-8 space-y-8 bg-black border-white/10 relative overflow-hidden">
                            <div className="flex justify-between items-start border-b border-white/10 pb-6">
                              <div>
                                <h3 className="text-xl font-black uppercase tracking-tighter text-primary">REPORTE HISTÓRICO</h3>
                                <p className="text-xs font-mono font-bold text-white/70 uppercase tracking-widest">{archiveDate}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-black text-white">{getUserLabel(userToLiquidate)}</p>
                                <p className="text-[11px] font-mono font-bold text-white/70 uppercase">ID: {userToLiquidate?.sellerId}</p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                <p className="text-[11px] font-mono font-bold text-white/70 uppercase tracking-widest mb-1">Ventas Totales</p>
                                <p className="text-lg font-black text-white">${summary.totalSales.toFixed(2)}</p>
                              </div>
                              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                <p className="text-[11px] font-mono font-bold text-white/70 uppercase tracking-widest mb-1">Comisiones</p>
                                <p className="text-lg font-black text-orange-400">-${summary.totalCommissions.toFixed(2)}</p>
                              </div>
                              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                <p className="text-[11px] font-mono font-bold text-white/70 uppercase tracking-widest mb-1">Premios Pagados</p>
                                <p className="text-lg font-black text-red-400">-${summary.totalPrizes.toFixed(2)}</p>
                              </div>
                            </div>

                            <div className="bg-primary/10 p-6 rounded-2xl border border-primary/20 flex justify-between items-center">
                              <div>
                                <p className="text-xs font-mono font-bold text-primary uppercase tracking-widest mb-1">Utilidad Neta</p>
                                <p className={`text-3xl font-black ${summary.netProfit < 0 ? 'text-red-500' : 'text-green-400'}`}>
                                  ${summary.netProfit.toFixed(2)}
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-4">
                              <button 
                                onClick={() => {
                                  setSelectedUserToLiquidate(archiveUserEmail);
                                  setLiquidationDate(archiveDate);
                                  setActiveTab('liquidaciones');
                                }}
                                className="flex-1 bg-primary text-primary-foreground font-black uppercase tracking-widest py-4 rounded-xl hover:brightness-110 transition-all shadow-lg shadow-primary/20"
                              >
                                Ir a Liquidar
                              </button>
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm uppercase tracking-widest border-2 border-dashed border-border rounded-2xl p-10">
                          {isArchiveLoading ? 'Cargando datos...' : 'Seleccione usuario y fecha para consultar'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'recovery' && userProfile?.role === 'programador' && (
              <motion.div
                key="recovery"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                <div className="glass-card p-4 sm:p-6 md:p-8">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-2xl font-black italic tracking-tighter neon-text uppercase">RECUPERACIÓN</h2>
                      <p className="text-xs font-mono text-muted-foreground mt-1 uppercase tracking-widest">
                        Corrección manual de sorteo por ticket (live + archivo diario)
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={fetchRecoveryData}
                        disabled={isRecoveryLoading}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60"
                      >
                        {isRecoveryLoading ? 'Cargando...' : 'Recargar'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
                    <div className="space-y-1">
                      <label className="                      text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Fecha operativa</label>
                      <input
                        type="date"
                        value={recoveryDate}
                        onChange={(e) => setRecoveryDate(e.target.value)}
                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">Usuario / Seller</label>
                      <input
                        type="text"
                        value={recoverySellerFilter}
                        onChange={(e) => setRecoverySellerFilter(e.target.value)}
                        placeholder="nombre, correo, sellerId"
                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">Sorteo guardado</label>
                      <input
                        type="text"
                        value={recoveryLotteryFilter}
                        onChange={(e) => setRecoveryLotteryFilter(e.target.value)}
                        placeholder="texto libre"
                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">Ticket ID</label>
                      <input
                        type="text"
                        value={recoveryTicketIdFilter}
                        onChange={(e) => setRecoveryTicketIdFilter(e.target.value)}
                        placeholder="id ticket"
                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="                      text-xs font-mono font-bold uppercase tracking-widest text-white/70">Estado</label>
                      <select
                        value={recoveryStatusFilter}
                        onChange={(e) => setRecoveryStatusFilter(e.target.value as 'ALL' | 'active' | 'winner' | 'cancelled' | 'liquidated')}
                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                      >
                        <option value="ALL">Todos</option>
                        <option value="active">active</option>
                        <option value="winner">winner</option>
                        <option value="cancelled">cancelled</option>
                        <option value="liquidated">liquidated</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">Orden creación</label>
                      <select
                        value={recoverySortOrder}
                        onChange={(e) => setRecoverySortOrder(e.target.value as 'asc' | 'desc')}
                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                      >
                        <option value="asc">Ascendente</option>
                        <option value="desc">Descendente</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-4 text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Tickets mostrados: {filteredRecoveryTickets.length} / {recoveryTickets.length}
                  </div>

                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => {
                        if (!filteredRecoveryTickets.length) return toast.info('No hay tickets filtrados para exportar');
                        // sort by seller then lottery to group
                        const list = [...filteredRecoveryTickets].sort((a, b) => {
                          const sa = (a.sellerName || '').localeCompare(b.sellerName || '');
                          if (sa !== 0) return sa;
                          return getRecoveryTicketLotteryLabel(a).localeCompare(getRecoveryTicketLotteryLabel(b));
                        });
                        setExportRecoveryList(list);
                      }}
                      disabled={isExportingRecovery}
                      className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60"
                    >
                      {isExportingRecovery ? 'Exportando...' : 'Descargar filtrados (PDF)'}
                    </button>
                    <button
                      onClick={() => {
                        if (!filteredRecoveryTickets.length) return toast.info('No hay tickets filtrados para exportar');
                        // quick share: download single ZIP-like PDF as above
                        const list = [...filteredRecoveryTickets].sort((a, b) => {
                          const sa = (a.sellerName || '').localeCompare(b.sellerName || '');
                          if (sa !== 0) return sa;
                          return getRecoveryTicketLotteryLabel(a).localeCompare(getRecoveryTicketLotteryLabel(b));
                        });
                        setExportRecoveryList(list);
                      }}
                      disabled={isExportingRecovery}
                      className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-60"
                    >
                      {isExportingRecovery ? 'Exportando...' : 'Descargar por lotes (imágenes en PDF)'}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {filteredRecoveryTickets.map((ticket) => {
                      const timestampMs = parseTicketTimestampMs(ticket.timestamp);
                      const createdAt = timestampMs ? format(new Date(timestampMs), 'yyyy-MM-dd hh:mm:ss a') : '-';
                      const ticketLotteryNames = getRecoveryTicketLotteryNames(ticket);
                      const isMultipleTicket = ticketLotteryNames.length > 1;
                      const selectedMultiMap = recoveryTargetLotteryMapByRow[ticket.rowId] || {};
                      const canSaveTicket = isMultipleTicket
                        ? ticketLotteryNames.every(sourceLottery => Boolean(selectedMultiMap[sourceLottery]))
                        : Boolean(recoveryTargetLotteryByRow[ticket.rowId]);
                      return (
                        <div key={ticket.rowId} className="rounded-xl border border-white/10 bg-black/40 p-3">
                          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-end">
                            <div className="xl:col-span-3">
                              <p className="text-xs font-mono font-bold uppercase text-white/70">Ticket</p>
                              <p className="text-xs font-black break-all">{ticket.id}</p>
                              <p className="text-xs font-mono font-semibold text-white/70 mt-1">{ticket.source === 'tickets' ? 'LIVE' : `ARCHIVO ${ticket.archiveDate}`}</p>
                            </div>
                            <div className="xl:col-span-2">
                              <p className="text-xs font-mono font-bold uppercase text-white/70">Usuario</p>
                              <p className="text-xs font-bold">{getUserLabel({ email: ticket.sellerEmail, name: ticket.sellerName }) || ticket.sellerId || '-'}</p>
                              <p className="text-xs font-mono font-semibold text-white/70 break-all">{ticket.sellerEmail || '-'}</p>
                            </div>
                            <div className="xl:col-span-2">
                              <p className="text-xs font-mono font-bold uppercase text-white/70">Creación</p>
                              <p className="text-xs font-mono">{createdAt}</p>
                              <p className="text-xs font-mono font-semibold text-white/70">Estado: {ticket.status || '-'}</p>
                            </div>
                            <div className="xl:col-span-2">
                              <p className="text-xs font-mono font-bold uppercase text-white/70">Sorteo actual</p>
                              <p className="text-xs font-bold">{getRecoveryTicketLotteryLabel(ticket)}</p>
                              <p className="text-xs font-mono font-semibold text-white/70">Total: USD {(ticket.totalAmount || 0).toFixed(2)}</p>
                            </div>
                            <div className="xl:col-span-2">
                              <p className="text-xs font-mono font-bold uppercase text-white/70">Nuevo sorteo</p>
                              {isMultipleTicket ? (
                                <div className="space-y-1.5">
                                  {ticketLotteryNames.map(sourceLottery => (
                                    <div key={`${ticket.rowId}-${sourceLottery}`} className="space-y-1">
                                      <p className="text-[11px] font-mono font-semibold text-white/70">De: {sourceLottery}</p>
                                      <select
                                        value={selectedMultiMap[sourceLottery] || ''}
                                        onChange={(e) => setRecoveryTargetLotteryMapByRow(prev => ({
                                          ...prev,
                                          [ticket.rowId]: {
                                            ...(prev[ticket.rowId] || {}),
                                            [sourceLottery]: e.target.value
                                          }
                                        }))}
                                        className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                                      >
                                        <option value="">Seleccionar...</option>
                                        {recoveryAvailableLotteries.map(lot => (
                                          <option key={`${ticket.rowId}-${sourceLottery}-${lot.id}`} value={lot.id}>
                                            {cleanText(lot.name)} {lot.drawTime ? `(${formatTime12h(lot.drawTime)})` : ''} {lot.active ? '' : '[INACTIVO]'}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <select
                                  value={recoveryTargetLotteryByRow[ticket.rowId] || ''}
                                  onChange={(e) => setRecoveryTargetLotteryByRow(prev => ({ ...prev, [ticket.rowId]: e.target.value }))}
                                  className="w-full bg-black border border-border p-2 rounded-lg font-mono text-xs"
                                >
                                  <option value="">Seleccionar...</option>
                                  {recoveryAvailableLotteries.map(lot => (
                                    <option key={`${ticket.rowId}-${lot.id}`} value={lot.id}>
                                      {cleanText(lot.name)} {lot.drawTime ? `(${formatTime12h(lot.drawTime)})` : ''} {lot.active ? '' : '[INACTIVO]'}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <div className="xl:col-span-1 space-y-1">
                              <button
                                onClick={() => saveRecoveryLotteryChange(ticket)}
                                disabled={recoverySavingRowId === ticket.rowId || recoveryDeletingRowId === ticket.rowId || !canSaveTicket}
                                className="w-full bg-primary text-primary-foreground p-2 rounded-lg text-xs font-black uppercase tracking-widest disabled:opacity-60"
                              >
                                {recoverySavingRowId === ticket.rowId ? 'Guardando' : 'Guardar'}
                              </button>
                              <button
                                onClick={() => deleteRecoveryTicket(ticket)}
                                disabled={recoverySavingRowId === ticket.rowId || recoveryDeletingRowId === ticket.rowId}
                                className="w-full bg-red-500/20 text-red-400 border border-red-500/30 p-2 rounded-lg text-xs font-black uppercase tracking-widest disabled:opacity-60"
                              >
                                {recoveryDeletingRowId === ticket.rowId ? 'Eliminando' : 'Eliminar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {filteredRecoveryTickets.length === 0 && (
                      <div className="h-40 flex items-center justify-center text-muted-foreground font-mono text-xs uppercase tracking-widest border-2 border-dashed border-border rounded-xl">
                        No hay tickets con esos filtros
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'config' && (
              <motion.div
                key="config"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-8"
              >
                {configTabsBar}
                {configSection === 'chances' && (
                  <div className="glass-card p-4 sm:p-6 md:p-8">
                    <ChancePricesSection
                      settings={globalSettings}
                      canEdit={isConfigAdmin}
                      onSave={async (prices) => {
                        try {
                          await setDoc(doc(db, 'settings', 'global'), { ...globalSettings, chancePrices: prices });
                          toast.success('Precios guardados');
                        } catch (error) {
                          handleFirestoreError(error, OperationType.WRITE, 'settings/global');
                        }
                      }}
                    />
                  </div>
                )}
                {configSection === 'especiales' && (
                  <div className="glass-card p-4 sm:p-6 md:p-8">
                    <GlobalSettingsModal
                      inline
                      show
                      section={configSection}
                      settings={globalSettings}
                      onSave={async (data) => {
                        try {
                          await setDoc(doc(db, 'settings', 'global'), data);
                          toast.success('Ajustes guardados');
                        } catch (error) {
                          handleFirestoreError(error, OperationType.WRITE, 'settings/global');
                        }
                      }}
                      onClose={() => {}}
                    />
                  </div>
                )}
                {(configSection === 'dispositivos' || configSection === 'perfil') && (
                <div className="glass-card p-4 sm:p-6 md:p-10">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-6">
                    <div>
                      <h2 className="text-2xl font-black italic tracking-tighter neon-text uppercase">CONFIGURACIÓN</h2>
                      <p className="text-xs font-mono text-muted-foreground mt-1 uppercase tracking-widest">Ajustes Personales y del Sistema</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                    <div className={`glass-card p-6 border-white/5 bg-white/[0.02] space-y-6 ${configSection !== 'dispositivos' ? 'hidden' : ''}`}>
                      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                          <Printer className="w-5 h-5" />
                        </div>
                        <h3 className="font-black uppercase tracking-widest text-sm">Impresora Bluetooth</h3>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                          <p className="                          text-xs font-black text-white/70 uppercase tracking-widest">Estado</p>
                          <p className="mt-1 text-sm font-bold">
                            {bluetoothPrinterConfig ? bluetoothPrinterConfig.deviceName : 'Sin impresora conectada'}
                          </p>
                          {bluetoothPrinterConfig && (
                            <p className="mt-1                             text-xs font-mono font-bold text-white/70 uppercase">
                              Papel {bluetoothPrinterConfig.paperWidth}mm
                            </p>
                          )}
                        </div>

                        {isNativeAndroid() ? (
                          <div className="space-y-3">
                            <button
                              type="button"
                              onClick={loadNativeBluetoothPrinters}
                              disabled={isLoadingNativePrinters}
                              className="w-full bg-white/5 border border-white/10 text-white py-3 rounded-xl font-black uppercase                               tracking-widest text-xs hover:bg-white/10 transition-all disabled:opacity-50"
                            >
                              {isLoadingNativePrinters ? 'Buscando...' : 'Buscar Vinculadas'}
                            </button>

                            <div className="space-y-2">
                              <label className="text-xs font-black text-white/70 uppercase tracking-widest">Impresora vinculada</label>
                              <select
                                value={selectedNativePrinterAddress}
                                onChange={(e) => setSelectedNativePrinterAddress(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all"
                              >
                                <option value="">Seleccionar...</option>
                                {nativeBluetoothPrinters.map(device => (
                                  <option key={device.address} value={device.address}>
                                    {device.name || 'Impresora Bluetooth'} ({device.address})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <button
                              type="button"
                              onClick={() => NativeBluetoothPrinter.openBluetoothSettings()}
                              className="w-full bg-white/5 border border-white/10 text-white py-3 rounded-xl font-black uppercase                               tracking-widest text-xs hover:bg-white/10 transition-all"
                            >
                              Abrir Bluetooth
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-xs font-black text-white/70 uppercase tracking-widest">Tipo de conexion</label>
                            <select
                              value={selectedBluetoothPrinterProfileId}
                              onChange={(e) => setSelectedBluetoothPrinterProfileId(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all"
                            >
                              {BLUETOOTH_PRINTER_PROFILES.map(profile => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="space-y-2">
                          <label className="text-xs font-black text-white/70 uppercase tracking-widest">Ancho de papel</label>
                          <select
                            value={selectedPrinterPaperWidth}
                            onChange={(e) => setSelectedPrinterPaperWidth(e.target.value as PrinterPaperWidth)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all"
                          >
                            <option value="58">58 mm</option>
                            <option value="80">80 mm</option>
                          </select>
                        </div>

                        <button
                          type="button"
                          onClick={handleConnectBluetoothPrinter}
                          disabled={isConnectingPrinter}
                          className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-primary/90 transition-all disabled:opacity-50"
                        >
                          {isConnectingPrinter ? 'Conectando...' : 'Conectar Impresora'}
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={handleTestBluetoothPrinter}
                            disabled={!bluetoothPrinterConfig}
                            className="bg-white/5 border border-white/10 text-white py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-white/10 transition-all disabled:opacity-50"
                          >
                            Probar
                          </button>
                          <button
                            type="button"
                            onClick={handleForgetBluetoothPrinter}
                            disabled={!bluetoothPrinterConfig}
                            className="bg-red-500/10 border border-red-500/20 text-red-400 py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-red-500/20 transition-all disabled:opacity-50"
                          >
                            Olvidar
                          </button>
                        </div>

                        <p className="                        text-xs font-semibold text-white/70 leading-relaxed">
                          {isNativeAndroid()
                            ? 'En el APK usa impresoras termicas ESC/POS vinculadas por Bluetooth en Android.'
                            : 'En navegador usa impresoras termicas ESC/POS BLE. En Chrome Android debe abrirse por HTTPS.'}
                        </p>
                      </div>
                    </div>

                    {/* Seguridad */}
                    <div className={`glass-card p-6 border-white/5 bg-white/[0.02] space-y-6 ${configSection !== 'perfil' ? 'hidden' : ''}`}>
                      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
                          <Lock className="w-5 h-5" />
                        </div>
                        <h3 className="font-black uppercase tracking-widest text-sm">Seguridad</h3>
                      </div>

                      <form onSubmit={handleUpdatePassword} className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-xs font-black text-white/70 uppercase tracking-widest">Nueva Contraseña</label>
                          <input 
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all"
                            placeholder="Mínimo 6 caracteres"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-black text-white/70 uppercase tracking-widest">Confirmar Contraseña</label>
                          <input 
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all"
                            placeholder="Repita la contraseña"
                          />
                        </div>
                        <button 
                          type="submit"
                          disabled={isUpdatingPassword}
                          className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-primary/90 transition-all disabled:opacity-50"
                        >
                          {isUpdatingPassword ? 'Actualizando...' : 'Cambiar Contraseña'}
                        </button>
                      </form>
                    </div>
                    {configSection === 'perfil' && canViewPaleSimulation && (
                      <div className="glass-card p-6 border-amber-400/20 bg-amber-400/[0.03] space-y-5">
                        <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                          <div className="rounded-lg bg-amber-400/15 p-2 text-amber-300">
                            <Trophy className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-black uppercase tracking-widest text-sm">Coincidencias informativas de Palé</h3>
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-100/60">Solo CEO principal y programador</p>
                          </div>
                        </div>

                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
                          <input
                            type="checkbox"
                            checked={paleSimulationSettings.enabled}
                            onChange={event => setPaleSimulationSettings(current => ({ ...current, enabled: event.target.checked }))}
                            className="mt-0.5 h-4 w-4 accent-amber-400"
                          />
                          <span>
                            <span className="block text-xs font-black uppercase tracking-wider text-white">Mostrar coincidencias 1.º + 3.º</span>
                            <span className="mt-1 block text-[11px] leading-relaxed text-white/60">Se muestran aparte cuando el multiplicador real de esa combinación está en 0.</span>
                          </span>
                        </label>

                        <div className="space-y-2">
                          <label htmlFor="pale-simulation-multiplier" className="text-xs font-black uppercase tracking-widest text-white/70">
                            Multiplicador informativo
                          </label>
                          <input
                            id="pale-simulation-multiplier"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={paleSimulationMultiplierInput}
                            onChange={event => setPaleSimulationMultiplierInput(event.target.value)}
                            placeholder="Sin configurar"
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
                          />
                          <p className="text-[11px] leading-relaxed text-white/60">
                            Se calcula como el monto apostado × este multiplicador. Si queda vacío, se marca la coincidencia sin monto. No cambia premios reales ni liquidaciones; vendedores y clientes no ven este dato, tampoco en la imagen compartida.
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={isSavingPaleSimulation}
                          onClick={async () => {
                            const rawMultiplier = paleSimulationMultiplierInput.trim();
                            const multiplier = rawMultiplier ? Number(rawMultiplier) : null;
                            if (rawMultiplier && (!Number.isFinite(multiplier) || (multiplier ?? 0) <= 0)) {
                              toast.error('El multiplicador informativo debe ser mayor que 0');
                              return;
                            }
                            setIsSavingPaleSimulation(true);
                            try {
                              await setDoc(doc(db, 'settings', 'paleSimulation'), {
                                enabled: paleSimulationSettings.enabled,
                                multiplier,
                                updatedAt: serverTimestamp()
                              });
                              toast.success('Ajuste informativo guardado');
                            } catch (error) {
                              handleFirestoreError(error, OperationType.WRITE, 'settings/paleSimulation');
                            } finally {
                              setIsSavingPaleSimulation(false);
                            }
                          }}
                          className="w-full rounded-xl bg-amber-400 py-3 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-amber-300 disabled:opacity-50"
                        >
                          {isSavingPaleSimulation ? 'Guardando...' : 'Guardar ajuste informativo'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {isMobile && !isSidebarOpen && (
          <BottomNav
            activeTab={activeTab}
            setActiveTab={tab => {
              setActiveTab(tab);
              setIsSidebarOpen(false);
            }}
          />
        )}

        {/* Footer */}
        <footer className={`${isMobile ? 'hidden' : ''} h-auto min-h-12 glass border-t border-border px-3 sm:px-8 py-2 flex items-center justify-between gap-2 shrink-0 text-[8px] sm:text-[9px] font-terminal text-muted-foreground uppercase tracking-[0.12em] sm:tracking-[0.2em]`}>
          <p>© 2026 CHANCE PRO SYSTEMS • TERMINAL {user.uid.slice(0, 8)}</p>
          <div className="flex gap-3 sm:gap-8 flex-wrap justify-end">
            <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> SERVER: OK</span>
            <span>V1.2.0-STABLE</span>
          </div>
        </footer>
      </div>
        </div>
      )}
    </>
  );
}
