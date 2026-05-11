import type { Metadata }   from 'next';
import NavBar              from '../components/NavBar';
import VitalSageProvider   from '../components/VitalSageProvider';
import './globals.css';

export const metadata: Metadata = {
  title:       'VitalSage Demo — Next.js',
  description: 'Testing app for the VitalSage performance SDK',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VitalSageProvider>
          <NavBar />
          {children}
        </VitalSageProvider>
      </body>
    </html>
  );
}
