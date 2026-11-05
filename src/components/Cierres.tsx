import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download, FileText, Share2 } from 'lucide-react';
import { format } from 'date-fns';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { toast } from 'sonner';

// Interfaces (mantener las mismas)
interface Bet {
  number: string;
  lottery: string;
  amount: number;
  type: 'CH' | 'PL' | 'BL';
  quantity: number;
}

export interface LotteryTicket {
  id: string;
  bets: Bet[];
  totalAmount: number;
  timestamp: any;
  lotteryName: string;
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

export interface Lottery {
  id: string;
  name: string;
  drawTime: string;
  active: boolean;
  pricePerUnit?: number;
  closingTime?: string;
  isFourDigits?: boolean;
}

interface UserProfile {
  email: string;
  name: string;
  role: 'ceo' | 'admin' | 'seller';
  commissionRate: number;
  status: 'active' | 'inactive';
  uid?: string;
  canLiquidate?: boolean;
  currentDebt?: number;
  sessionTimeoutMinutes?: number;
  sellerId?: string;
}

interface CierresProps {
  tickets: LotteryTicket[];
  lotteries: Lottery[];
  userProfile?: UserProfile | null;
}

export const Cierres: React.FC<CierresProps> = ({ tickets, lotteries, userProfile }) => {
  const [selectedLotteryId, setSelectedLotteryId] = useState(lotteries[0]?.id || '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!selectedLotteryId && lotteries.length > 0) {
      setSelectedLotteryId(lotteries[0].id);
    }
  }, [lotteries, selectedLotteryId]);

  const cleanText = (text: string) => {
    if (!text) return '';
    return text
      .replace(/[ØÝ<][^a-zA-Z0-9\s()\-:/]*/g, 'Lotería')
      .replace(/Lotería+/g, 'Lotería')
      .replace(/Lotería\s+Lotería/g, 'Lotería')
      .trim();
  };

  const getLotteryName = (id: string) => {
    return lotteries.find(l => l.id === id)?.name || '';
  };

  const buildClosurePDF = () => {
    const doc = new jsPDF({ format: 'letter' });
    const selectedLotteryName = getLotteryName(selectedLotteryId);
    const normalizedSelectedName = cleanText(selectedLotteryName).toLowerCase();
    
    const validTickets = tickets.filter(t => {
      if (t.status !== 'active') return false;
      return t.sellerId === userProfile?.uid || t.sellerEmail?.toLowerCase() === userProfile?.email?.toLowerCase();
    });
    
    const betsPerNumber: { [key: string]: number } = {};
    for (let i = 0; i < 100; i++) {
        betsPerNumber[i.toString().padStart(2, '0')] = 0;
    }
    
    const palesBilletes: { type: string, numbers: string, amount: number }[] = [];
    let totalTiemposCount = 0;
    let totalSales = 0;
    let totalCommission = 0;

    validTickets.forEach(t => {
        const lotteryBets = t.bets?.filter(b => {
            const betLottery = b.lottery || '';
            const normalizedBetLottery = cleanText(betLottery).toLowerCase();
            return betLottery === selectedLotteryId || 
                   normalizedBetLottery === normalizedSelectedName ||
                   normalizedBetLottery === selectedLotteryId.toLowerCase();
        }) || [];

        if (lotteryBets.length === 0) return;

        const ticketLotterySales = lotteryBets.reduce((sum, b) => sum + b.amount, 0);
        totalSales += ticketLotterySales;
        totalCommission += ticketLotterySales * (t.commissionRate / 100);

        lotteryBets.forEach(b => {
            if (b.type === 'CH') {
                if (b.number && betsPerNumber.hasOwnProperty(b.number)) {
                    betsPerNumber[b.number] += b.quantity;
                    totalTiemposCount += b.quantity;
                }
            } else if (b.type === 'PL' || b.type === 'BL') {
                palesBilletes.push({
                    type: b.type === 'PL' ? 'Palé' : 'Billete',
                    numbers: b.number,
                    amount: b.amount
                });
            }
        });
    });

    const utility = totalSales - totalCommission;
    const lotteryObj = lotteries.find(l => l.id === selectedLotteryId);
    const drawTime = lotteryObj?.drawTime || '';
    const cleanLotteryName = cleanText(selectedLotteryName);

    // Header
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('CIERRE DE SORTEO', 105, 15, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`${cleanLotteryName}${drawTime ? ' - ' + drawTime : ''}`, 105, 22, { align: 'center' });
    doc.text(format(new Date(), 'yyyy-MM-dd'), 105, 28, { align: 'center' });
    
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 32, 196, 32);
    
    doc.setFontSize(10);
    doc.text(`Operador: ${userProfile?.name || 'Usuario'}`, 105, 38, { align: 'center' });
    
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 42, 196, 42);

    // Boxes
    doc.setFillColor(245, 245, 245);
    doc.rect(14, 46, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Total Tiempos:', 20, 51.5);
    doc.text(totalTiemposCount.toString(), 190, 51.5, { align: 'right' });
    
    doc.setFillColor(46, 204, 113);
    doc.rect(14, 56, 182, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text('TOTAL VENDIDO:', 20, 62.5);
    doc.text(`$${totalSales.toFixed(2)}`, 190, 62.5, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('NÚMEROS VENDIDOS', 105, 73, { align: 'center' });

    const tableData: any[][] = [];
    const entries = Object.entries(betsPerNumber);
    
    for (let i = 0; i < 25; i++) {
        const row = [];
        for (let j = 0; j < 4; j++) {
            const index = i + j * 25;
            const [num, count] = entries[index];
            row.push(num, count > 0 ? count : '-');
        }
        tableData.push(row);
    }

    autoTable(doc, {
        startY: 77,
        head: [['Núm', 'Cant', 'Núm', 'Cant', 'Núm', 'Cant', 'Núm', 'Cant']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontSize: 7, halign: 'center', lineWidth: 0.1, cellPadding: 1 },
        bodyStyles: { fontSize: 7, halign: 'center', textColor: [100, 100, 100], cellPadding: 0.8 },
        columnStyles: {
            0: { fontStyle: 'bold', textColor: [0, 0, 0] },
            1: { textColor: [46, 204, 113], fontStyle: 'bold' },
            2: { fontStyle: 'bold', textColor: [0, 0, 0] },
            3: { textColor: [46, 204, 113], fontStyle: 'bold' },
            4: { fontStyle: 'bold', textColor: [0, 0, 0] },
            5: { textColor: [46, 204, 113], fontStyle: 'bold' },
            6: { fontStyle: 'bold', textColor: [0, 0, 0] },
            7: { textColor: [46, 204, 113], fontStyle: 'bold' },
        },
        margin: { left: 14, right: 14 }
    });

    let finalY = (doc as any).lastAutoTable.finalY + 6;

    if (palesBilletes.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Palés y Billetes Vendidos', 14, finalY);
        
        autoTable(doc, {
            startY: finalY + 3,
            head: [['Tipo', 'Números', 'Monto']],
            body: palesBilletes.map(pb => [pb.type, pb.numbers, `$${pb.amount.toFixed(2)}`]),
            theme: 'striped',
            headStyles: { fillColor: [52, 73, 94], fontSize: 8, cellPadding: 1 },
            bodyStyles: { fontSize: 8, cellPadding: 0.8 },
            margin: { left: 14, right: 14 }
        });
        finalY = (doc as any).lastAutoTable.finalY + 6;
    }

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN FINANCIERO', 14, finalY);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Tiempos (Chances): ${totalTiemposCount}`, 14, finalY + 6);
    doc.text(`Total Ventas (Incluye Palés/Billetes): $${totalSales.toFixed(2)}`, 14, finalY + 11);
    doc.text(`Comisión Vendedor(es): $${totalCommission.toFixed(2)}`, 14, finalY + 16);
    
    doc.setFont('helvetica', 'bold');
    doc.text(`Utilidad Neta: $${utility.toFixed(2)}`, 14, finalY + 23);
    
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(150, 150, 150);
    doc.text(`Generado el ${format(new Date(), 'd/M/yyyy, h:mm:ss a')}`, 105, 272, { align: 'center' });

    const fileName = `Cierre_${cleanLotteryName.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`;
    
    return { doc, fileName, cleanLotteryName };
  };

  const generatePDF = async (save: boolean = true) => {
    setIsGenerating(true);
    try {
      const { doc, fileName } = buildClosurePDF();
      
      if (save) {
        try {
          const pdfBase64 = doc.output('datauristring').split(',')[1];
          await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Documents
          });
          toast.success("Reporte guardado en Documentos");
        } catch (e) {
          doc.save(fileName);
        }
      } else {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Error al generar el reporte");
    } finally {
      setIsGenerating(false);
    }
  };

  const sharePDF = async () => {
    setIsGenerating(true);
    try {
      const { doc, fileName } = buildClosurePDF();
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      
      try {
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Cache
        });

        await Share.share({
          title: 'Cierre de Sorteo',
          url: savedFile.uri,
        });
      } catch (capErr) {
        console.log('Capacitor share failed, falling back to web download', capErr);
        doc.save(fileName);
        toast.success('Reporte descargado');
      }
    } catch (error) {
      console.error("Error sharing PDF:", error);
      toast.error("Error al compartir el reporte");
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper to get data for UI display
  const getSummaryData = () => {
    const selectedLotteryName = getLotteryName(selectedLotteryId);
    const normalizedSelectedName = cleanText(selectedLotteryName).toLowerCase();
    
    const validTickets = tickets.filter(t => {
      if (t.status !== 'active') return false;
      return t.sellerId === userProfile?.uid || t.sellerEmail?.toLowerCase() === userProfile?.email?.toLowerCase();
    });
    
    const betsPerNumber: { [key: string]: number } = {};
    for (let i = 0; i < 100; i++) {
        betsPerNumber[i.toString().padStart(2, '0')] = 0;
    }
    
    const palesBilletes: { type: string, numbers: string, amount: number }[] = [];
    let totalTiemposCount = 0;
    let totalSales = 0;
    let totalCommission = 0;

    validTickets.forEach(t => {
        const lotteryBets = t.bets?.filter(b => {
            const betLottery = b.lottery || '';
            const normalizedBetLottery = cleanText(betLottery).toLowerCase();
            return betLottery === selectedLotteryId || 
                   normalizedBetLottery === normalizedSelectedName ||
                   normalizedBetLottery === selectedLotteryId.toLowerCase();
        }) || [];

        if (lotteryBets.length === 0) return;

        const ticketLotterySales = lotteryBets.reduce((sum, b) => sum + b.amount, 0);
        totalSales += ticketLotterySales;
        totalCommission += ticketLotterySales * (t.commissionRate / 100);

        lotteryBets.forEach(b => {
            if (b.type === 'CH') {
                if (b.number && betsPerNumber.hasOwnProperty(b.number)) {
                    betsPerNumber[b.number] += b.quantity;
                    totalTiemposCount += b.quantity;
                }
            } else if (b.type === 'PL' || b.type === 'BL') {
                palesBilletes.push({
                    type: b.type === 'PL' ? 'Palé' : 'Billete',
                    numbers: b.number,
                    amount: b.amount
                });
            }
        });
    });

    return { betsPerNumber, palesBilletes, totalTiemposCount, totalSales, totalCommission, utility: totalSales - totalCommission };
  };

  const summaryData = previewUrl ? getSummaryData() : null;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black italic tracking-tighter neon-text uppercase flex items-center gap-2">
            <FileText className="w-6 h-6" /> CIERRES
          </h2>
          <p className="text-xs font-mono text-muted-foreground mt-1 uppercase tracking-widest">Reportes de Venta por Sorteo</p>
        </div>
      </div>

      <div className="glass-card p-6 border-white/5 bg-white/[0.02] flex flex-col sm:flex-row gap-4 items-end">
        <div className="w-full sm:w-1/2 space-y-2">
          <label className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Seleccionar Sorteo</label>
          <select 
            value={selectedLotteryId}
            onChange={(e) => {
              setSelectedLotteryId(e.target.value);
              setPreviewUrl(null);
            }}
            className="w-full bg-black border border-border p-3 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          >
            {lotteries.map(l => (
              <option key={l.id} value={l.id} className="bg-gray-900">
                {cleanText(l.name)} {l.drawTime ? `(${l.drawTime})` : ''}
              </option>
            ))}
          </select>
        </div>
        
        <button 
          onClick={() => generatePDF(false)}
          disabled={isGenerating}
          className="w-full sm:w-auto bg-primary text-primary-foreground px-8 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
        >
          <FileText className="w-5 h-5" /> {isGenerating ? 'Generando...' : 'Previsualizar'}
        </button>
      </div>

      {previewUrl && summaryData && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Vista Previa del Reporte</h3>
            <div className="flex gap-2 w-full sm:w-auto">
              <button 
                onClick={sharePDF}
                disabled={isGenerating}
                className="flex-1 sm:flex-none bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" /> {isGenerating ? 'Preparando...' : 'Compartir'}
              </button>
            </div>
          </div>
          
          {/* UI Tables for Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card p-4">
              <h4 className="text-xs font-bold uppercase mb-4">Números Vendidos</h4>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {Object.entries(summaryData.betsPerNumber).map(([num, count]) => (
                  <div key={num} className="bg-white/5 p-2 rounded">
                    <span className="font-bold">{num}</span>: <span className="text-primary">{count > 0 ? count : '-'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-card p-4">
              <h4 className="text-xs font-bold uppercase mb-4">Palés y Billetes</h4>
              {summaryData.palesBilletes.length > 0 ? (
                <div className="space-y-2">
                  {summaryData.palesBilletes.map((pb, idx) => (
                    <div key={idx} className="flex justify-between text-xs bg-white/5 p-2 rounded">
                      <span>{pb.type} ({pb.numbers})</span>
                      <span className="font-bold">${pb.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">No hay palés o billetes.</p>}
            </div>
          </div>

          <div className="w-full h-[60vh] md:h-[800px] bg-white rounded-xl overflow-hidden shadow-2xl border border-white/10">
            <iframe 
              src={previewUrl} 
              className="w-full h-full border-none"
              title="PDF Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
};
