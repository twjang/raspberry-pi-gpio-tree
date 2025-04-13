#!/usr/bin/env python

import argparse
import math
import time
from websocket import create_connection

def parse_args()-> argparse.Namespace:
    parser = argparse.ArgumentParser(description='WebSocket client')
    parser.add_argument('--host', type=str, default='raspzero.vpn.nyam.kr', help='Host to connect to')
    parser.add_argument('--port', type=int, default=3000, help='Port to connect to')
    parser.add_argument('--period', type=float, default=5.0, help='Period for the function')
    parser.add_argument('mode', type=str, help='mode')
    args = parser.parse_args()
    return args

def func_sine(x: float, period: float) -> int:
    return int((math.sin(x * 2.0 * math.pi / period) + 1.0) / 2.0 * 99 + 1)

def func_square(x: float, period: float) -> int:
    return 100 if (x % period) < (period / 2) else 1

def func_triangle(x: float, period: float) -> int:
    return int((2.0 / period) * (x % period) * 99 + 1) if (x % period) < (period / 2) else int((2.0 / period) * (period - (x % period)) * 99 + 1)


def main(args: argparse.Namespace):
    args = parse_args()
    ws = create_connection(f"ws://{args.host}:{args.port}/")

    if args.mode == 'test':
        while True:
            p = input()
            p = p.strip()
            if p == '': break
            ws.send(p)
            result =  ws.recv().strip()
            print("Received '%s'" % result)
    elif args.mode.startswith('func_'):
        t0 = time.time()
        func = None
        if args.mode == 'func_sine':
            func = func_sine
        elif args.mode == 'func_square':
            func = func_square
        elif args.mode == 'func_triangle':
            func = func_triangle
        else:
            raise ValueError(f"Unknown mode: {args.mode}")

        brightness = 0
        try:
            while True:
                delta_t = time.time() - t0
                n_period = delta_t / args.period
                delta_t = delta_t - int(n_period) * args.period

                brightness = func(delta_t, args.period)
                brightness = max(min(brightness, 100), 1)
                cmd = f'set {brightness}'
                print(cmd)
                ws.send(cmd)
                result =  ws.recv().strip()
        except KeyboardInterrupt:
            pass
    ws.close()

if __name__ == '__main__':
    args = parse_args()
    main(args)