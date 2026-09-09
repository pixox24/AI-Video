import dotenv from "dotenv";
import { startServer } from "./src-server/app";

dotenv.config();

startServer().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
