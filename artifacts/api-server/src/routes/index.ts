import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import dashboardRouter from "./dashboard";
import casesRouter from "./cases";
import accountsRouter from "./accounts";
import transactionsRouter from "./transactions";
import reconciliationRouter from "./reconciliation";
import schedulesRouter from "./schedules";
import propertyRouter from "./property";
import queriesRouter from "./queries";
import documentsRouter from "./documents";
import legalRouter from "./legal";
import assistantRouter from "./assistant";
import reportsRouter from "./reports";
import storageRouter from "./storage";
import { requireUser } from "../lib/access";

const router: IRouter = Router();

router.use(healthRouter);
// Everything below requires a signed-in user.
router.use(requireUser);
router.use(meRouter);
router.use(dashboardRouter);
router.use(casesRouter);
router.use(accountsRouter);
router.use(transactionsRouter);
router.use(reconciliationRouter);
router.use(schedulesRouter);
router.use(propertyRouter);
router.use(queriesRouter);
router.use(documentsRouter);
router.use(legalRouter);
router.use(assistantRouter);
router.use(reportsRouter);
router.use(storageRouter);

export default router;
