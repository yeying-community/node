#!/usr/bin/env bash
set -x

COLOR_RED='\033[1;31m'
COLOR_BLUE='\033[1;34m'
COLOR_NC='\033[0m'

base_name="${0##*/}"
script_dir=$(
  cd $(dirname "$0") || exit 1
  pwd
)

source "${script_dir}"/functions.sh

work_dir=$(
  cd "${script_dir}"/.. || exit 1
  pwd
)

usage() {
  printf "Usage: %s\n \
    -d <Set debug mode.> \n \
    -h <Set service port.> \n \
    -e <Set run environment, such as dev or prod.> \n \
    -t <Set http tls enable> \n \
    -s <Skip the compiler> \n \
    " "${base_name}"
}


env=dev
tls=false
skip=false
# For macos`s getopt, reference: https://formulae.brew.sh/formula/gnu-getopt
while getopts ":dtsh:e:" o; do
  case "${o}" in
  t)
    tls=true
    ;;
  s)
    skip=true
    ;;
  # d)
  #   debug_param='--debug'
  #   ;;
  h)
    app_port=${OPTARG}
    ;;
  e)
    env=${OPTARG}
    ;;
  *)
    usage
    ;;
  esac
done
shift $((OPTIND - 1))

envoy_parameter=""
if [ "${env}" == "dev" ]; then
  export APP_ENV=dev
  # 默认开发环境的端口，为了方便调试，不同的服务，以及服务运行的环境不一样，端口也都会有区别，另外用户也可以强制指定端口
  if [ -z "${app_port}" ]; then
    app_port=8100
  fi
  envoy_parameter="-l info"
elif [ "${env}" == "prod" ]; then
  if [ -z "${app_port}" ]; then
    app_port=8100
  fi
else
  echo -e "${COLOR_RED}Not supported environment variable, please set dev or prod!${COLOR_NC}"
  usage
  exit 1
fi

# 设置 base_id
base_id=${app_port}

index=1
printf "\n"
echo -e "step $index -- This is going to start node under ${COLOR_BLUE} ${env} ${COLOR_NC} environment. [$(date)]"
echo "work dir=${work_dir}, port=${app_port}"

run_dir=${work_dir}/run
python_script=${work_dir}/script/load_template.py
cert_dir=${run_dir}/cert

des_conf_dir=${run_dir}/config
des_log_dir=${run_dir}/log

if [ ! -d "${run_dir}" ]; then
  mkdir -p "${run_dir}"
fi

template_dir="${work_dir}/resources/template"
if [ -d "${run_dir}"/template ]; then
  rm -rf "${run_dir}"/template
fi
if [ -d "${template_dir}" ]; then
  cp -rf "${template_dir}" "${run_dir}"
fi

if [ ! -d "${des_conf_dir}" ]; then
  mkdir -p "${des_conf_dir}"
fi

if [ ! -d "${des_log_dir}" ]; then
  mkdir -p "${des_log_dir}"
fi

index=$((index + 1))
printf "\n"
echo -e "step $index -- kill process if these exist"
# 如果pid文件存在，则读取其中的进程ID并杀死这些进程
pid_file=${run_dir}/pid.txt
kill_process_with_pid_file "${pid_file}" true

envoy_array=("/usr/bin/envoy" "/usr/local/bin/envoy")
envoy_bin=$(get_string_by_os "${envoy_array[@]}")
envoy_config=""
echo "The enableTls of envoy is ${tls}"
if [ "$tls" = true ]; then
  envoy_config="envoy.tls.yaml"
  mkdir -p "${cert_dir}"
  if [[ -e "${cert_dir}"/fullchain.pem && -e "${cert_dir}"/privkey.pem ]];then
    echo -e "tls_certificates files are exists"
  else
    echo -e "${COLOR_RED}tls_certificates files under run/cert should be both exists. ${COLOR_NC}"
    exit 1
  fi
else
  envoy_config="envoy.yaml"
fi

envoy_template_dir="${work_dir}/resources/envoy"
if [ -f "${envoy_template_dir}/${envoy_config}" ]; then
  if ! python_module_check_by_pip3 Jinja2; then
    echo -e "${COLOR_RED}You have to install python module(Jinja2) manually firstly. ${COLOR_NC}"
    exit 1
  fi
  python3 "${python_script}" "${envoy_template_dir}/${envoy_config}" "${des_conf_dir}/envoy.yaml" "${cert_dir}" "${app_port}"
else
  echo -e "${COLOR_BLUE}Envoy template not found, skip envoy config generation.${COLOR_NC}"
fi

# 设置配置文件路径
export APP_CONFIG_PATH="${work_dir}/config.json"

cd "${run_dir}" || exit 1

index=$((index+1))
echo -e "step $index -- start node service"
export APP_PORT="${app_port}"

# start store service
if [ "$skip" = true ]; then
  echo -e "Skip compile stage."
else
  npm run build
fi

nohup node "${work_dir}/dist/server.js" > "${des_log_dir}/start.log" 2>&1 &
echo $! >> "${pid_file}"

index=$((index+1))
printf "\n"
echo -e "step $index -- check port of node"
if check_service_port 10 1 "${app_port}"; then
  echo "node started successfully."
else
  echo -e "${COLOR_RED}node Not started yet. ${COLOR_NC}"
fi

echo $! >> "${pid_file}"

echo "node startup operation finished. [$(date)]"

set +x
