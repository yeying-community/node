#!/usr/bin/env bash
# haiqinma - 20241208 - first version

set -u
set -o pipefail


SCRIPT_PATH=$(cd "$(dirname "$0")" || exit 1;pwd)
CODE_PATH=$(cd "${SCRIPT_PATH}"/.. || exit 1;pwd)
PACKAGE_BAKUP_PATH="/opt/bakup"
DEPLOY_PATH="/opt/deploy/yeying/"

COLOR_RED='\033[1;31m'
COLOR_BLUE='\033[1;34m'
COLOR_NC='\033[0m'

module_name="yeying-node"
index=1
echo -e "\nstep $index -- This is going to publish ${module_name}"
mkdir -p "${DEPLOY_PATH}"

index=$((index+1))
echo -e "\nstep $index -- generate ${module_name} package"
pushd "${CODE_PATH}" || exit 2
if [[ -f "script/package.sh" ]]; then
	./script/package.sh
else
	echo -e "${COLOR_RED}There is no script to generate package ${COLOR_NC}"
fi

tmp_results=$(ls output/yeying-*.tar.gz)
if [[ "$tmp_results" =~ "$module_name" ]]
then
	package_file=$(echo "$tmp_results" | cut -d '/' -f 2)
	echo -e "${COLOR_BLUE}Get package file [$package_file] under output directory ${COLOR_NC}"
else
	echo -e "${COLOR_RED}There is no package file under output directory ${COLOR_NC}"
	exit 3
fi
popd || exit 2


sleep 2
index=$((index+1))
echo -e "\nstep $index -- delete older package 5 days ago"
if [ -d /opt/backup ]
then
	find /opt/backup -type f -mtime +5 -exec rm -f {} \;
	find /opt/backup -type d -empty -delete
fi


sleep 2
index=$((index+1))
echo -e "\nstep $index -- bakup older package"
timestamp=$(date +%F_%H-%M-%S)
bakup_directory="$PACKAGE_BAKUP_PATH/$timestamp/"
mkdir -p "$bakup_directory"
old_package=$(ls ${DEPLOY_PATH}${module_name}*.tar.gz)
if [[ "$old_package" =~ "cannot access" ]]
	then
	echo -e "There is no package for ${module_name}"
else
	echo -e "bakup ${module_name} file: move $old_package to $bakup_directory"
	mv "$old_package" "$bakup_directory"
fi


index=$((index+1))
echo -e "\nstep $index -- copy package[${package_file}] to deploy directory ${DEPLOY_PATH}"
version=$(echo "$package_file" | cut -d '-' -f 3)
pushd "${CODE_PATH}" || exit 2
cp -a output/"${package_file}" "${DEPLOY_PATH}"
popd || exit 2


if [[ -d /tmp/"${module_name}-${version}" ]]
then
	rm -rf /tmp/"${module_name}-${version}"
fi


pushd "${DEPLOY_PATH}" || exit 2
tar -zxf "${package_file}" -C /tmp
untar_path=/tmp/"${module_name}-${version}"
if [[ -d "${untar_path}" ]]
then
	echo -e "package untar to ${untar_path}"
else
	echo -e "${COLOR_RED}untar ${package_file} to /tmp failed ${COLOR_NC}"
	exit 4
fi
if [[ ! -d "${module_name}" ]]
then
	mv "${untar_path}"  "${module_name}"
	echo -e "${COLOR_BLUE}You should startup ${module_name} manually at first time ${COLOR_NC}"
	exit 3
fi
popd || exit 2


sleep 2
index=$((index+1))
echo -e "\nstep $index -- stop service before update files"
running_path="${DEPLOY_PATH}""${module_name}"
if [[ -d "${running_path}" ]]
then
	pushd "${running_path}" || exit 2
	if [[ -f script/stop.sh ]]
	then
		bash ./script/stop.sh
	else
		echo -e "${COLOR_RED}there is no script to stop service ${COLOR_NC}"
		exit 5
	fi
	popd || exit 2
else
	echo -e "${COLOR_RED}there is no running path [${running_path}] ${COLOR_NC}"
	exit 6
fi


sleep 2
index=$((index+1))
echo -e "\nstep $index -- update files"
if [[ -f "${running_path}/config.js" ]]; then
  cp -a "${running_path}/config.js" "${untar_path}/"
fi
cp -a "${running_path}"/node_modules  "${untar_path}"/
cp -a "${running_path}"/run  "${untar_path}"/
rm -rf "${running_path}"
mv "${untar_path}" "${running_path}"

sleep 2
index=$((index+1))
echo -e "\nstep $index -- start service ${module_name}"
pushd "${running_path}" || exit 2
bash ./script/runner.sh -e prod
popd || exit 2


echo -e "\nThis is the end of publish ${module_name} code. Please check manually $(date)"
