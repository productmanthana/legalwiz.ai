import { type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell";
import { SignInPage, SignUpPage } from "@/pages/auth";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Cases from "@/pages/cases";
import CaseOverview from "@/pages/case-overview";
import Accounts from "@/pages/accounts";
import Transactions from "@/pages/transactions";
import Reconciliation from "@/pages/reconciliation";
import IncomeExpenditure from "@/pages/income-expenditure";
import Assets from "@/pages/assets";
import Family from "@/pages/family";
import Lokayukta from "@/pages/lokayukta";
import IncomeTax from "@/pages/income-tax";
import Queries from "@/pages/queries";
import QueryDetail from "@/pages/query-detail";
import Documents from "@/pages/documents";
import Assistant from "@/pages/assistant";
import CaseLegal from "@/pages/case-legal";
import Reports from "@/pages/reports";
import Legal from "@/pages/legal";
import Audit from "@/pages/audit";
import SettingsPage from "@/pages/settings";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const Loading = () => <div className="min-h-[100dvh] grid place-items-center"><div className="w-64 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-full" /></div></div>;

/** Signed-in when /me answers; a 401 means signed out. */
function useSession() {
  const { data: me, isLoading } = useGetMe({ query: { retry: false } });
  return { me, isLoading };
}

function MeGate({ children, allowUnonboarded }: { children: ReactNode; allowUnonboarded?: boolean }) {
  const { me, isLoading } = useSession();
  if (isLoading) return <Loading />;
  if (!me) return <Redirect to="/" />;
  if (!me.onboarded && !allowUnonboarded) return <Redirect to="/onboarding" />;
  return <>{children}</>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function protect(Comp: ComponentType, opts: { shell?: boolean; onboarding?: boolean } = { shell: true }) {
  return function Protected() {
    return (
      <MeGate allowUnonboarded={opts.onboarding}>
        {opts.shell ? <AppShell><RoutedErrorBoundary><Comp /></RoutedErrorBoundary></AppShell> : <Comp />}
      </MeGate>
    );
  };
}

function HomeRedirect() {
  const { me, isLoading } = useSession();
  if (isLoading) return <Loading />;
  if (!me) return <Landing />;
  return <Redirect to={me.onboarded ? "/dashboard" : "/onboarding"} />;
}

const P = {
  onboarding: protect(Onboarding, { onboarding: true }),
  dashboard: protect(Dashboard), cases: protect(Cases), caseOverview: protect(CaseOverview), accounts: protect(Accounts),
  transactions: protect(Transactions), reconciliation: protect(Reconciliation), ie: protect(IncomeExpenditure), assets: protect(Assets),
  family: protect(Family), lokayukta: protect(Lokayukta), incomeTax: protect(IncomeTax), queries: protect(Queries), queryDetail: protect(QueryDetail), documents: protect(Documents),
  assistant: protect(Assistant), caseLegal: protect(CaseLegal), reports: protect(Reports), legal: protect(Legal), audit: protect(Audit), settings: protect(SettingsPage),
};

function AppRoutes() {
  return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/onboarding" component={P.onboarding} />
            <Route path="/dashboard" component={P.dashboard} />
            <Route path="/cases" component={P.cases} />
            <Route path="/cases/:caseId" component={P.caseOverview} />
            <Route path="/cases/:caseId/accounts" component={P.accounts} />
            <Route path="/cases/:caseId/transactions" component={P.transactions} />
            <Route path="/cases/:caseId/reconciliation" component={P.reconciliation} />
            <Route path="/cases/:caseId/income-expenditure" component={P.ie} />
            <Route path="/cases/:caseId/assets" component={P.assets} />
            <Route path="/cases/:caseId/family" component={P.family} />
            <Route path="/cases/:caseId/lokayukta" component={P.lokayukta} />
            <Route path="/cases/:caseId/income-tax" component={P.incomeTax} />
            <Route path="/cases/:caseId/queries" component={P.queries} />
            <Route path="/cases/:caseId/queries/:queryId" component={P.queryDetail} />
            <Route path="/cases/:caseId/documents" component={P.documents} />
            <Route path="/cases/:caseId/assistant" component={P.assistant} />
            <Route path="/cases/:caseId/legal" component={P.caseLegal} />
            <Route path="/cases/:caseId/reports" component={P.reports} />
            <Route path="/legal" component={P.legal} />
            <Route path="/audit" component={P.audit} />
            <Route path="/settings" component={P.settings} />
            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

export default App;
