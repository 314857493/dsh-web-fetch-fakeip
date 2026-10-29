# dsh-web-fetch-fakeip

[English](README.en.md) · [MIT License](LICENSE)

解决 DeepSeek Harness / DSH Desktop 的网页抓取在 Clash Fake-IP 模式下出现的 `WEB_BLOCKED_URL`：

```text
URL hostname "example.com" resolves to a non-public IP address
```

默认保留 DSH 原有 HTTP 传输。只有原组件拒绝目标，且再次查询得到的 **全部 DNS 地址均属于 `198.18.0.0/16`** 时，才通过插件自己的 HTTP 代理连接重试。

## 为什么需要它

Clash 可以把公网域名映射到 Fake-IP。DSH 的公网地址校验会把这种地址拦截，因此可能出现「搜索返回链接，但抓不到正文」。把进程设为 DIRECT 并不能消除这一步 DNS 校验。

本插件只为默认 `http` 抓取 provider 增加条件回退：

| 情况 | 行为 |
| --- | --- |
| 原有 HTTP 传输成功 | 直接返回，不创建插件代理 |
| `WEB_BLOCKED_URL`，DNS 全部命中 `198.18.0.0/16` | 通过指定 HTTP 代理重试 |
| 内网、环回、链路本地、空结果或混合 DNS 地址 | 保持原错误 |
| DNS 失败、连接失败、TLS 错误、超时 | 不触发代理回退 |
| URL 直接使用非公网 IP | 拦截，不允许用代理绕过 |

不更改系统代理、Clash 配置、shell 环境变量、全局 `fetch` 或全局 dispatcher。模型 API、搜索工具和终端子进程不受插件影响。若 DSH 本身已经配置了全局代理，原组件仍遵循它的配置。

## 安装

要求 Node.js **22.19+**，以及能提供下列 peer dependencies 的 DSH：

- `@deepseek-ai/dsh-web-fetch-http@0.2.1-rc.4`
- `@deepseek-ai/dsh-web@0.2.1-rc.4`
- `@deepseek-ai/dsh-timeout@0.2.1-rc.4`

当前版本针对这组 DSH 组件验证。使用导出的 `HttpFetchProvider`，但覆写的 `requestOnce` 属于实现扩展点；DSH 升级后应重新验证，不能承诺兼容所有版本。

通过 DSH 官方插件管理命令，从本仓库的发布标签安装：

```sh
dsh plugin --profile web add 'git+https://github.com/314857493/dsh-web-fetch-fakeip.git#v0.3.0'
```

macOS DSH Desktop 未提供 `dsh` 命令时，可使用应用自带入口：

```sh
DSH_HOME="$HOME/.dsh-desktop" \
  "/Applications/DSH Desktop.app/Contents/Resources/node/node" \
  "/Applications/DSH Desktop.app/Contents/Resources/dsh/lib/bin.js" \
  plugin --profile web add \
  'git+https://github.com/314857493/dsh-web-fetch-fakeip.git#v0.3.0'
```

这里的 `DSH_HOME` 仅用于该安装命令定位数据目录，不会写入 shell 配置。如果你自定义了数据目录，请使用自己的路径。安装完成后完全退出并重新打开 DSH。

**从早期本地 `dsh-web-fetch-proxy` 迁移时，先移除旧插件，再安装本插件。** 两者不能同时注册 `http` provider。

```sh
dsh plugin --profile web remove dsh-web-fetch-proxy
```

本项目目前只发布在 GitHub，尚未发布到 npm。不要使用未经确认的同名 npm 包。

## 配置

默认代理：`http://127.0.0.1:7897`。请按你的 HTTP 或 mixed 端口修改；不支持 SOCKS URL 或 URL 内嵌凭据。

在对应 profile 的 `cordis.patch.yml` 中添加以下覆盖项。Desktop 默认位置为 `~/.dsh-desktop/profiles/web/cordis.patch.yml`：

```yaml
- id: web-fetch-fakeip
  config:
    proxyUrl: http://127.0.0.1:7897
```

可选参数与默认值：

| 参数 | 默认值 |
| --- | --- |
| `maxResponseBytes` | `5000000` |
| `maxBodyChars` | `100000` |
| `timeoutMs` | `30000` |
| `maxRedirects` | `5` |
| `userAgent` | 沿用 DSH 默认值 |

Fake-IP 检测目前只接受 `198.18.0.0/16`（也识别 IPv4-mapped IPv6）。这是明确选择的地址池，不是对任意 Fake-IP 实现的自动发现。不会把所有非公网地址都视为 Fake-IP，也不会把 `198.19.0.0/16` 自动加入例外。

作用范围是此 profile 中使用默认 `http` 抓取 provider 的所有会话，不局限于单个会话。若设置中改用了其他抓取 provider，例如 `deepseek-fetch-api`，本插件不会接管。

## 验证与开发

```sh
git clone https://github.com/314857493/dsh-web-fetch-fakeip.git
cd dsh-web-fetch-fakeip
npm ci --ignore-scripts
npm run check
```

默认测试使用本地 HTTP 代理和本地源站，不需要 Clash、外网或 API 密钥。覆盖路由判定、实际代理请求、全局状态隔离、重定向、响应大小、超时、取消及代理断开。

需要真实网络验证时显式运行：

```sh
npm run test:live -- https://example.com http://127.0.0.1:7897
```

输出包含 HTTP 状态、正文长度和 Fake-IP 回退次数，不输出正文或环境变量。

## 卸载

```sh
dsh plugin --profile web remove dsh-web-fetch-fakeip
```

移除你添加的 `web-fetch-fakeip` 配置覆盖项，然后重启 DSH。插件 bundle 被移除后，原 `web-fetch-http` 组件恢复。

## 实现与安全边界

插件通过 Cordis bundle 禁用原 `web-fetch-http` 行，注册自己的实现，并保留 provider id `http`。普通路径继续使用 DSH 原有 DNS 校验和地址固定；正文读取、超时、同源重定向与容量限制仍由原组件负责。

Fake-IP 例外把目标域名解析交给用户配置的可信代理。这不证明域名在代理端一定解析为公网地址；代理端必须提供所需的访问控制。参见 [SECURITY.md](SECURITY.md)，其中也记录了 DSH peer dependencies 的审计限制。
