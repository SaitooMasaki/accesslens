import jwt from 'jsonwebtoken';
import { logger } from '../logger.js';

/** Bearer JWT を検証してreq.userにペイロードをセットする */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    logger.warn({ err: err.message }, 'JWT verification failed');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * 指定プランのいずれかを持つユーザーのみ通過させる。
 * requireAuth の後に呼ぶこと。
 */
export function requirePlan(...plans) {
  return (req, res, next) => {
    if (!plans.includes(req.user?.plan)) {
      return res.status(403).json({
        error: `This feature requires a ${plans.join(' or ')} plan`,
      });
    }
    next();
  };
}
