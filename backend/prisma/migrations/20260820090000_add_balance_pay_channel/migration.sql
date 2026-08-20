-- Allow subscription orders paid from the enterprise wallet.
ALTER TYPE "PayChannel" ADD VALUE IF NOT EXISTS 'BALANCE';
