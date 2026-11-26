import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell, Logo } from "@/components/shell";
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

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(224 58% 22%)",
    colorForeground: "hsl(223 45% 14%)",
    colorMutedForeground: "hsl(219 14% 40%)",
    colorDanger: "hsl(356 62% 44%)",
    colorBackground: "hsl(210 40% 99.5%)",
    colorInput: "hsl(0 0% 100% / 0.6)",
    colorInputForeground: "hsl(223 45% 14%)",
    colorNeutral: "hsl(223 45% 14%)",
    fontFamily: "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[hsl(210_40%_99.5%)] rounded-xl w-[440px] max-w-full overflow-hidden border border-[hsl(216_24%_88%)] shadow-[0_18px_40px_-10px_hsl(224_50%_20%/0.18)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "!font-['Newsreader'] !text-[26px] !font-medium !text-[hsl(223_45%_14%)]",
    headerSubtitle: "!text-[hsl(219_14%_40%)]",
    socialButtonsBlockButtonText: "!text-[hsl(223_45%_14%)] !font-medium",
    formFieldLabel: "!text-[hsl(223_45%_18%)] !font-semibold !text-xs",
    footerActionLink: "!text-[hsl(176_56%_30%)] !font-semibold",
    footerActionText: "!text-[hsl(219_14%_40%)]",
    dividerText: "!text-[hsl(219_14%_45%)]",
    identityPreviewEditButton: "!text-[hsl(176_56%_30%)]",
    formFieldSuccessText: "!text-[hsl(158_52%_30%)]",
    alertText: "!text-[hsl(356_62%_36%)]",
    logoBox: "!h-11 !justify-center",
    logoImage: "!h-11 !w-11",
    socialButtonsBlockButton: "!border-[hsl(216_20%_82%)] !bg-white/70",
    formButtonPrimary: "!bg-[hsl(224_58%_22%)] !text-white !shadow-none !font-semibold",
    formFieldInput: "!border-[hsl(216_20%_82%)] !bg-white/70",
    footerAction: "!justify-center",
    dividerLine: "!bg-[hsl(216_22%_86%)]",
    alert: "!border-[hsl(356_62%_44%/0.3)] !bg-[hsl(356_62%_44%/0.05)]",
    otpCodeFieldInput: "!border-[hsl(216_20%_78%)]",
    formFieldRow: "!gap-3",
    main: "!gap-5",
  },
};

function AuthFrame({ children, kind }: { children: ReactNode; kind: "in" | "up" }) {
  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.05fr_1fr] bg-background grain">
      <div className="hidden lg:flex relative flex-col justify-between bg-sidebar text-sidebar-foreground p-10 overflow-hidden">
        <img src={`${basePath}/hero-ledger.jpg`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity" />
        <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/70 to-sidebar/30" />
        <div className="relative"><Logo light /></div>
        <div className="relative max-w-md">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sidebar-primary mb-3">{kind === "in" ? "Return to your records" : "Open a register"}</div>
          <p className="font-display text-[34px] leading-[1.12] text-white">Every rupee accounted for. Every conclusion left to the people whose job it is.</p>
          <p className="text-sm mt-4 text-sidebar-foreground/70">Shared cases are logged. Investigators see only what has been explicitly shared with them.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame kind="in">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame kind="up">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function MeGate({ children, allowUnonboarded }: { children: ReactNode; allowUnonboarded?: boolean }) {
  const { data: me, isLoading } = useGetMe();
  if (isLoading) return <div className="min-h-[100dvh] grid place-items-center"><div className="w-64 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-full" /></div></div>;
  if (me && !me.onboarded && !allowUnonboarded) return <Redirect to="/onboarding" />;
  return <>{children}</>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function protect(Comp: ComponentType, opts: { shell?: boolean; onboarding?: boolean } = { shell: true }) {
  return function Protected() {
    return (
      <>
        <Show when="signed-in">
          <MeGate allowUnonboarded={opts.onboarding}>
            {opts.shell ? <AppShell><RoutedErrorBoundary><Comp /></RoutedErrorBoundary></AppShell> : <Comp />}
          </MeGate>
        </Show>
        <Show when="signed-out"><Redirect to="/" /></Show>
      </>
    );
  };
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><MeGate><Redirect to="/dashboard" /></MeGate></Show>
      <Show when="signed-out"><Landing /></Show>
    </>
  );
}

const P = {
  onboarding: protect(Onboarding, { onboarding: true }),
  dashboard: protect(Dashboard), cases: protect(Cases), caseOverview: protect(CaseOverview), accounts: protect(Accounts),
  transactions: protect(Transactions), reconciliation: protect(Reconciliation), ie: protect(IncomeExpenditure), assets: protect(Assets),
  family: protect(Family), lokayukta: protect(Lokayukta), incomeTax: protect(IncomeTax), queries: protect(Queries), queryDetail: protect(QueryDetail), documents: protect(Documents),
  assistant: protect(Assistant), caseLegal: protect(CaseLegal), reports: protect(Reports), legal: protect(Legal), audit: protect(Audit), settings: protect(SettingsPage),
};

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Sign in to FINTRACE", subtitle: "Your case registers are waiting" } },
        signUp: { start: { title: "Create your FINTRACE account", subtitle: "For subjects, advocates, chartered accountants and authorised officers" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
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
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
