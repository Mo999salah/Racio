import { Geist, Noto_Sans_Arabic } from 'next/font/google';
import { cn } from '@/lib/utils';
import './globals.css';

const geist = Geist({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-geist',
  display: 'swap',
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-sans-arabic',
  display: 'swap',
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(geist.variable, notoSansArabic.variable, 'font-sans')}>
      <body>{children}</body>
    </html>
  );
}
