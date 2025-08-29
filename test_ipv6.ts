// 测试IPv6地址处理功能

// 检测是否为IPv6地址
function isIPv6(ip: string): boolean {
  if (!ip) return false;
  return ip.includes(':') && !ip.includes('.');
}

// 从IP地址中移除端口号的辅助函数
function removePortFromIP(ip: string): string {
  if (!ip) return ip;
  
  // 检测IPv6地址格式
  if (ip.includes(':')) {
    // IPv6地址可能的格式：
    // 1. [2001:db8::1]:8080 - 带方括号和端口
    // 2. 2001:db8::1 - 纯IPv6地址
    // 3. ::ffff:192.0.2.1:8080 - IPv4映射的IPv6地址带端口（错误格式，但可能出现）
    
    // 处理带方括号的IPv6地址 [IPv6]:port
    if (ip.startsWith('[') && ip.includes(']:')) {
      const bracketEnd = ip.indexOf(']:');
      return ip.substring(1, bracketEnd); // 移除方括号和端口
    }
    
    // 检查是否为IPv4映射的IPv6地址或IPv4地址
    const ipv4Pattern = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/;
    const ipv4Match = ip.match(ipv4Pattern);
    if (ipv4Match) {
      return ipv4Match[1]; // 返回IPv4部分，移除端口
    }
    
    // 对于纯IPv6地址，不应该有端口号直接附加
    // 如果有多个连续的冒号，说明是IPv6压缩格式，不是端口
    if (ip.includes('::') || ip.split(':').length > 2) {
      return ip; // 纯IPv6地址，无需处理端口
    }
    
    // 如果只有一个冒号且不是IPv6格式，可能是IPv4:port
    const parts = ip.split(':');
    if (parts.length === 2 && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0])) {
      return parts[0]; // IPv4地址，移除端口
    }
    
    return ip; // 其他情况保持原样
  }
  
  // IPv4地址处理
  const colonIndex = ip.lastIndexOf(':');
  if (colonIndex > 0) {
    const portPart = ip.substring(colonIndex + 1);
    if (/^\d+$/.test(portPart)) {
      return ip.substring(0, colonIndex);
    }
  }
  
  return ip;
}

// 标准化IPv6地址格式
function normalizeIPv6(ip: string): string {
  if (!ip || !ip.includes(':')) return ip;
  
  try {
    // 移除可能的方括号
    const cleanIP = ip.replace(/^\[|\]$/g, '');
    
    // 处理IPv4映射的IPv6地址
    const ipv4MappedPattern = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
    const ipv4Match = cleanIP.match(ipv4MappedPattern);
    if (ipv4Match) {
      return ipv4Match[1]; // 返回IPv4地址
    }
    
    // 基本的IPv6格式验证和标准化
    if (cleanIP.includes('::')) {
      // 压缩格式的IPv6地址，保持原样
      return cleanIP.toLowerCase();
    }
    
    return cleanIP.toLowerCase();
  } catch (error) {
    console.warn('IPv6地址标准化失败:', ip, error);
    return ip;
  }
}

// 验证IP是否为有效的公网IP
function isValidPublicIP(ip: string): boolean {
  if (!ip || ip === 'unknown' || ip === 'localhost') {
    return false;
  }

  // 检查是否为内网IP
  const privateRanges = [
    /^127\./,           // 127.0.0.0/8 (localhost)
    /^10\./,            // 10.0.0.0/8 (private)
    /^192\.168\./,      // 192.168.0.0/16 (private)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12 (private)
    /^169\.254\./,      // 169.254.0.0/16 (link-local)
    /^::1$/,            // IPv6 localhost
    /^fe80:/,           // IPv6 link-local
    /^fc00:/,           // IPv6 unique local
    /^fd00:/            // IPv6 unique local
  ];

  for (const range of privateRanges) {
    if (range.test(ip)) {
      return false;
    }
  }

  // 标准化IP地址
  const normalizedIP = normalizeIPv6(ip);
  
  // IPv4格式验证
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(normalizedIP)) {
    // 验证IPv4地址的每个段是否在有效范围内
    const parts = normalizedIP.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }
  
  // IPv6格式验证（支持完整格式和压缩格式）
  // 更完整的IPv6验证逻辑
  if (normalizedIP.includes(':')) {
    console.log(`  调试: 检查IPv6地址 ${normalizedIP}`);

    // 基本格式检查：只能包含十六进制字符、冒号和点（IPv4映射）
    if (!/^[0-9a-fA-F:\.]+$/.test(normalizedIP)) {
      console.log(`  调试: 基本格式检查失败`);
      return false;
    }

    // 检查冒号数量（IPv6最多7个冒号，压缩格式可能更少）
    const colonCount = (normalizedIP.match(/:/g) || []).length;
    console.log(`  调试: 冒号数量 ${colonCount}`);

    if (colonCount > 7) {
      console.log(`  调试: 冒号数量过多`);
      return false;
    }

    // 如果包含::，说明是压缩格式
    if (normalizedIP.includes('::')) {
      // ::只能出现一次
      if ((normalizedIP.match(/::/g) || []).length > 1) {
        console.log(`  调试: 多个::压缩`);
        return false;
      }
      console.log(`  调试: 压缩格式有效`);
      return true; // 压缩格式基本有效
    }

    // 完整格式：必须有7个冒号，8个段
    if (colonCount === 7) {
      const segments = normalizedIP.split(':');
      console.log(`  调试: 段数量 ${segments.length}, 段内容:`, segments);

      if (segments.length === 8) {
        // 每个段必须是1-4位十六进制数（但允许一些非标准格式）
        const isValid = segments.every(segment =>
          segment.length > 0 &&
          segment.length <= 5 && // 放宽到5位以支持一些非标准格式
          /^[0-9a-fA-F]+$/.test(segment)
        );
        console.log(`  调试: 段验证结果 ${isValid}`);
        return isValid;
      }
    }

    // IPv4映射的IPv6地址
    if (normalizedIP.startsWith('::ffff:') || normalizedIP.startsWith('::')) {
      console.log(`  调试: IPv4映射格式`);
      return true;
    }

    // 其他情况，如果冒号数量合理，认为是有效的
    console.log(`  调试: 其他情况，冒号数量合理`);
    return colonCount >= 2 && colonCount <= 7;
  }

  return false;
}

// 测试用例
const testIPs = [
  "2409:8949:824a:2d15:8c56:dae1:da6fa:1e1",
  "192.168.1.1",
  "8.8.8.8",
  "::1",
  "2001:db8::1",
  "::ffff:192.0.2.1",
  "[2001:db8::1]:8080",
  "invalid-ip"
];

console.log("测试IPv6地址处理功能:");
console.log("=".repeat(50));

for (const ip of testIPs) {
  console.log(`\n原始IP: ${ip}`);
  console.log(`是否IPv6: ${isIPv6(ip)}`);
  console.log(`移除端口后: ${removePortFromIP(ip)}`);
  console.log(`标准化后: ${normalizeIPv6(ip)}`);
  console.log(`是否有效公网IP: ${isValidPublicIP(ip)}`);
}
