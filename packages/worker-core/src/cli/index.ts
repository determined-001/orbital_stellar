import yargs, { Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import pino from 'pino';
import { readFileSync } from 'fs';

const logger = pino{ level: process.env.LOG_LEVEL || 'info' };

// ----------- Types ------------

type Worker = {
  id: string;
  name: string;
  schedule: string;
};

type Transaction = {
  to: string;
  amount: string;
  data: string;
};

type Fee = {
  amount: string;
  token: string;
};

type SimulatedResponse = {
  status: string;
  output: string;
};

// ----------- Secret policy ------------

type SecretSource = {
  env?: string;
  file?: string;
};

function parseSecret(value: string): SecretSource {
  if (value.startsWith('env:')) return { env: value.slice(4) };
  if (value.startsWith('file:')) return { file: value.slice(5) };
  throw new Error('--secret must be of the form env:VAR_NAME or file:PATH');
}

function resolveSecret(secret: SecretSource | undefined): string | undefined {
  if (!secret) return undefined;
  if (secret.env) {
    const value = process.env[secret.env];
    if (!value) throw new Error(`Environment variable ${secret.env} is not set`);
    return value;
  }
  if (secret.file) {
    const value = readFileSync(secret.file, 'utf8').trim();
    return value;
  }
  throw new Error('Secret source must specify env or file');
}

function validateSecret(secret: SecretSource | undefined): boolean {
  if (!secret) return true;
  if (secret.env || secret.file) return true;
  throw new Error('Secret must reference env:VAR or file:PATH, not a raw value');
}

// ----------- Command handlers ------------

async function handleRegister(argv: any) {
  const secret = resolveSecret(argv.secret);
  const worker: Worker = {
    id: `${Date.now()}`,
    name: argv.name,
    schedule: argv.schedule,
  };
  console.log(JSON.stringify({ command: 'register', worker, secretProvided: !!secret }, null, 2));
}

async function handleList() {
  // In a real implementation, this would query the worker registry.
  const workers: Worker[] = [];
  console.log(JSON.stringify({ workers }, null, 2));
}

async function handleInspect(argv: any) {
  const worker: Worker = {
    id: `worker-${argv.name}`,
    name: argv.name,
    schedule: '*/5 * * * *',
  };
  console.log(JSON.stringify({ worker }, null, 2));
}

async function handleDryRun(argv: any) {
  // Simulate building a transaction from the worker's last run.
  const transaction: Transaction = {
    to: '0x' + '1'.repeat(40),
    amount: '1.25',
    data: '0x',
  };
  const fee: Fee = {
    amount: '0.001',
    token: 'ORB',
  };
  const simulatedResponse: SimulatedResponse = {
    status: 'success',
    output: 'null',
  };
  console.log(JSON.stringify({ transaction, fee, simulatedResponse }, null, 2));
}

async function handleRun(argv: any) {
  const intervalMs = argv.interval as number;
  const iterations = argv.iterations as number;
  logger.info({ intervalMs, iterations }, 'starting scheduler loop');
  let count = 0;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      count++;
      logger.info({ iteration: count, status: 'tick' }, 'scheduler tick');
      if (count >= iterations) {
        clearInterval(timer);
        resolve();
      }
    }, intervalMs);
  });
  logger.info('scheduler loop stopped');
}

// ----------- Command modules ------------

const registerCommand: yargs.CommandModule = {
  command: 'register <name>',
  describe: 'Register a new worker',
  builder: (yargs) => {
    return yargs
      .positional('name', { type: 'string', demandOption: true })
      .option('schedule', {
        type: 'string',
        alias: 's',
        describe: 'Cron schedule for the worker',
        default: '*/5 * * * *',
      })
      .option('secret', {
        type: 'string',
        alias: 'S',
        describe: 'Secret source (env:VAR_NAME or file:PATH)',
        coerce: parseSecret,
      })
      .check((argv) => validateSecret(argv.secret));
  },
  handler: handleRegister,
};

const listCommand: yargs.CommandModule = {
  command: 'list',
  describe: 'List registered workers',
  handler: handleList,
};

const inspectCommand: yargs.CommandModule = {
  command: 'inspect <name>',
  describe: 'Inspect a worker by name',
  builder: (yargs) => yargs.positional('name', { type: 'string', demandOption: true }),
  handler: handleInspect,
};

const dryRunCommand: yargs.CommandModule = {
  command: 'dry-run <name>',
  describe: 'Simulate a worker invocation without submitting',
  builder: (yargs) => yargs.positional('name', { type: 'string', demandOption: true }),
  handler: handleDryRun,
};

const runCommand: yargs.CommandModule = {
  command: 'ren',
  describe: 'Run the scheduler loop in the foreground',
  builder: (yargs) => {
    return yargs
      .option('interval', {
        type: 'number',
        describe: 'Scheduler interval in milliseconds',
        default: 1000,
      })
      .option('iterations', {
        type: 'number',
        describe: 'Number of iterations before stopping (useful for testing)',
        default: Number.POSITIVE_INFINITY,
      });
  },
  handler: handleRun,
};

// ----------- Parser ------------

export function createParser(args?: string[]): Argv {
  return yargs(args ?? hideBin(process.argv))
    .scriptName('orbital worker')
    .usage('$0 <command> [options]')
    .command(registerCommand)
    .command(listCommand)
    .command(inspectCommand)
    .command(dryRunCommand)
    .command(runCommand)
    .demandCommand(1, 'You must specify a command')
    .strict()
    .help()
    .version(false)
    .wrap(null);
}

export async function run(argv: string[]): Promise<void> {
  // Support both `orbital worker <cmd>` and `orbital-worker <cmd>`.
  if (argv[0] === 'worker') {
    argv = argv.slice(1);
  }
  await createParser(argv).parseAsync();
}
