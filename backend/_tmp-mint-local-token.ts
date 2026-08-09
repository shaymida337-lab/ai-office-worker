import { config as loadEnv } from "dotenv";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";

// Local JWT for local backend (NOT prod secret)
const JWT_SECRET = "dev-secret-change-in-production";
const token = jwt.sign(
  {
    userId: "cmpjd7j7e0000bl5tu149spmk",
    organizationId: "cmpjd7j7e0001bl5tzv049rxb",
    email: "shaymida337@gmail.com",
  },
  JWT_SECRET,
  { expiresIn: "8h" }
);
writeFileSync(join(process.cwd(), ".tmp-local-token.txt"), token, "utf8");
console.log(JSON.stringify({ wrote: true, hasRenderDb: existsSync(join(process.cwd(), ".env.render-db.tmp")), tokenLen: token.length }));
