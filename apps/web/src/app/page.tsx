import { Toolbar } from '@/components/layout/Toolbar';
import { Sidebar } from '@/components/layout/Sidebar';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { BottomPanel } from '@/components/layout/BottomPanel';
import { PDFViewer } from '@/components/pdf/PDFViewer';
import { ContextMenu } from '@/components/ui/ContextMenu';
import { SessionBar } from '@/components/studio/SessionBar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function Home() {
  return (
    <>
      <main className="flex flex-col h-screen w-full bg-white text-gray-900 overflow-hidden">
        <ErrorBoundary label="Toolbar" compact>
          <Toolbar />
        </ErrorBoundary>
        <ErrorBoundary label="Session Bar" compact>
          <SessionBar />
        </ErrorBoundary>
        <div className="flex flex-1 overflow-hidden">
          <ErrorBoundary label="Sidebar" compact>
            <Sidebar />
          </ErrorBoundary>
          <div className="flex flex-col flex-1 overflow-hidden">
            <ErrorBoundary label="PDF Viewer">
              <PDFViewer />
            </ErrorBoundary>
            <ErrorBoundary label="Bottom Panel" compact>
              <BottomPanel />
            </ErrorBoundary>
          </div>
          <ErrorBoundary label="Properties Panel" compact>
            <RightSidebar />
          </ErrorBoundary>
        </div>
      </main>
      <ContextMenu />
    </>
  );
}



