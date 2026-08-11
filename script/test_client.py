#!/usr/bin/env python

import argparse
import math
import time
from websocket import create_connection

MIN_BRIGHTNESS = 1
MAX_BRIGHTNESS = 1000


def parse_args()-> argparse.Namespace:
    parser = argparse.ArgumentParser(description='WebSocket client')
    parser.add_argument('--host', type=str, default='192.168.0.179', help='Host to connect to')
    parser.add_argument('--port', type=int, default=3000, help='Port to connect to')
    parser.add_argument('--period', type=float, default=5.0, help='Period for the function')
    parser.add_argument('mode', type=str, help='mode')
    args = parser.parse_args()
    return args

def func_sine(x: float, period: float) -> int:
    brightness_range = MAX_BRIGHTNESS - MIN_BRIGHTNESS
    return int(
        (math.sin(x * 2.0 * math.pi / period) + 1.0)
        / 2.0
        * brightness_range
        + MIN_BRIGHTNESS
    )


def func_square(x: float, period: float) -> int:
    return MAX_BRIGHTNESS if (x % period) < (period / 2) else MIN_BRIGHTNESS


def func_triangle(x: float, period: float) -> int:
    brightness_range = MAX_BRIGHTNESS - MIN_BRIGHTNESS
    phase = x % period
    distance = phase if phase < (period / 2) else period - phase
    return int((2.0 / period) * distance * brightness_range + MIN_BRIGHTNESS)


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
                brightness = max(min(brightness, MAX_BRIGHTNESS), MIN_BRIGHTNESS)
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
