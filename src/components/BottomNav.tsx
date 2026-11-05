import React from 'react';
import { BarChart3, History, Ticket, Trophy } from 'lucide-react';

type BottomTab = 'sales' | 'history' | 'results' | 'stats';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: BottomTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { name: 'sales', icon: Ticket, label: 'Ventas' },
    { name: 'history', icon: History, label: 'Historial' },
    { name: 'results', icon: Trophy, label: 'Resultados' },
    { name: 'stats', icon: BarChart3, label: 'Reportes' },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-border bg-background/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.25)] backdrop-blur-lg">
      {tabs.map((tab) => (
        <button
          key={tab.name}
          onClick={() => setActiveTab(tab.name)}
          aria-current={activeTab === tab.name ? 'page' : undefined}
          className={`flex flex-col items-center gap-1 rounded-xl py-1.5 transition-all ${
            activeTab === tab.name ? 'scale-105 text-primary' : 'text-muted-foreground hover:text-white'
          }`}
        >
          <tab.icon className="h-5 w-5" strokeWidth={activeTab === tab.name ? 2.5 : 2} />
          <span className="text-[9px] font-extrabold uppercase tracking-wider">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
};
