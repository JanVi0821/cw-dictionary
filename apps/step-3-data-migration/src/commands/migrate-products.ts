import { migrate } from "../migrate.ts";
import { reportError } from "../database.ts";
migrate("products").catch(reportError);
