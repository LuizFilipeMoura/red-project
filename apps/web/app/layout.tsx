import './globals.css';
import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { ToasterProvider } from '../providers/toaster-provider';

export const metadata: Metadata = {
  title: 'Phaser Lobby Demo',
  description: 'Realtime turn-based lobby prototype with Turborepo',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
